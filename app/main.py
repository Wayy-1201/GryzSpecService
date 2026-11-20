import asyncio
import contextlib
import hashlib
import hmac
import io
import json
import logging
import re
import time
import uuid
from collections import defaultdict, deque
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from urllib.parse import urlparse


import httpx
import qrcode
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import ValidationError
from starlette.datastructures import UploadFile
from starlette.exceptions import HTTPException

from app.catalog import SERVICES
from app.config import ROOT, Settings
from app.repository import Repository, ConflictError
from app.schemas import OrderInput, Calculation, ChatInput
from app.services.calculator import Calculator
from app.services.notifications import Notifications
from app.services.photos import Photos, PhotoError

logging.basicConfig(level=logging.INFO)
logging.getLogger('httpx').setLevel(logging.WARNING)
logging.getLogger('httpcore').setLevel(logging.WARNING)
log = logging.getLogger('gss')


def ok(data, status=200):
    return JSONResponse({'success': True, 'data': data, 'error': None}, status_code=status)


def fail(message, status=400, code='REQUEST_ERROR', fields=None):
    return JSONResponse({'success': False, 'data': None, 'error': {'code': code, 'message': message, 'fields': fields or []}}, status_code=status)


class BodyLimit:
    """Count streamed bytes as well as Content-Length before multipart parsing."""
    def __init__(self, app, maximum=42 * 1024 * 1024):
        self.app, self.maximum = app, maximum

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http':
            return await self.app(scope, receive, send)
        length = dict(scope['headers']).get(b'content-length', b'0')
        try:
            too_large = int(length) > self.maximum
        except ValueError:
            too_large = True
        if too_large:
            return await fail('Суммарный размер файлов слишком большой', 413)(scope, receive, send)
        count = 0
        async def limited_receive():
            nonlocal count
            event = await receive()
            count += len(event.get('body', b''))
            if count > self.maximum:
                from starlette.exceptions import HTTPException
                raise HTTPException(413, 'Суммарный размер файлов слишком большой')
            return event
        await self.app(scope, limited_receive, send)


def create_app(settings=None):
    s = settings or Settings()
    @asynccontextmanager
    async def lifespan(app):
        # Local environments can expose a dead proxy (for example 127.0.0.1:9).
        # API calls should use the normal network connection unless configured otherwise.
        client = httpx.AsyncClient(follow_redirects=False, trust_env=False)
        repo = Repository(s, client)
        photos = Photos(s, client)
        app.state.repo, app.state.photos = repo, photos
        app.state.client, app.state.calculator = client, Calculator(s, client)
        app.state.notifications = Notifications(s, client, repo, photos)
        if s.app_env == 'production':
            await app.state.notifications.register_webhook()
        task = asyncio.create_task(app.state.notifications.run()) if s.worker_enabled else None
        polling_task = None
        if s.app_env != 'production' and s.telegram_ready:
            polling_task = asyncio.create_task(app.state.notifications.poll_telegram())
        yield
        if task:
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task
        if polling_task:
            polling_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await polling_task
        repo.close()
        await client.aclose()

    app = FastAPI(title='ГРУЗСПЕЦСЕРВИС API', lifespan=lifespan,
                  docs_url='/docs' if s.app_env != 'production' else None, redoc_url=None)
    app.state.settings = s
    app.add_middleware(BodyLimit)
    buckets = defaultdict(deque)

    @app.middleware('http')
    async def guard(request, call_next):
        if request.url.path.startswith('/api/') and request.url.path != '/api/telegram/webhook':
            client_ip = request.client.host if request.client else 'unknown'
            category = request.url.path if request.method == 'POST' else 'read'
            key = (client_ip, category)
            now = time.monotonic()
            queue = buckets[key]
            while queue and queue[0] < now - 60:
                queue.popleft()
            limit = 8 if 'orders' in category else 20 if category == '/api/chat' else 90
            if len(queue) >= limit:
                response = fail('Слишком много запросов. Попробуйте через минуту.', 429, 'RATE_LIMIT')
                response.headers['Retry-After'] = '60'
                return response
            queue.append(now)
            if len(buckets) > 10000:
                for old in list(buckets):
                    if not buckets[old] or buckets[old][-1] < now - 60:
                        del buckets[old]
            if request.method == 'POST':
                origin = request.headers.get('origin')
                if origin and urlparse(origin).netloc != request.headers.get('host'):
                    return fail('Запрос с другого сайта запрещён', 403)
        response = await call_next(request)
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers['Referrer-Policy'] = 'strict-origin-when-cross-origin'
        response.headers['Permissions-Policy'] = 'geolocation=(self "https://yandex.ru" "https://yandex.com"), camera=(), microphone=()'
        response.headers['X-Frame-Options'] = 'DENY'
        if request.url.path.startswith('/api/'):
            response.headers['Cache-Control'] = 'no-store'
        return response

    @app.exception_handler(RequestValidationError)
    async def request_validation(request, exc):
        return fail('Проверьте заполненные поля', 422, 'VALIDATION_ERROR')

    @app.exception_handler(HTTPException)
    async def http_error(request, exc):
        return fail(str(exc.detail), exc.status_code)

    @app.exception_handler(Exception)
    async def unexpected(request, exc):
        log.error('Request failed path=%s error=%s', request.url.path, type(exc).__name__)
        return fail('Не удалось выполнить запрос. Попробуйте ещё раз или позвоните нам.', 503, 'UNAVAILABLE')

    app.mount('/static', StaticFiles(directory=ROOT / 'static'), name='static')

    @app.get('/')
    async def index():
        return FileResponse(ROOT / 'templates/index.html', headers={'Cache-Control': 'no-cache'})

    @app.get('/health')
    async def health():
        return {'status': 'ok'}

    @app.get('/api/config')
    async def config():
        return ok(s.public())

    @app.get('/api/services')
    async def services():
        return ok(SERVICES)

    @app.get('/api/stats')
    async def stats():
        result = await app.state.repo.stats()
        result['years'] = s.company_years
        return ok(result)

    @app.get('/api/reviews')
    async def reviews():
        org = s.yandex_org_id if re.fullmatch(r'\d+', s.yandex_org_id) else ''
        return ok({'source': 'Яндекс Карты', 'widget_url': f'https://yandex.ru/maps-reviews-widget/{org}?comments' if org else None,
                   'url': f'https://yandex.ru/maps/org/{org}/reviews/' if org else None})

    @app.get('/api/qr/{channel}')
    async def qr(channel: str):
        value = {'telegram': s.telegram_url, 'max': s.max_url}.get(channel, '')
        if not value.startswith('https://'):
            return fail('Контакт пока не указан', 404)
        image = qrcode.make(value)
        stream = io.BytesIO()
        image.save(stream, format='PNG')
        return Response(stream.getvalue(), media_type='image/png')

    @app.get('/api/privacy')
    async def privacy():
        from pathlib import Path
        return ok({'text': Path(s.privacy_file).read_text(encoding='utf-8')})

    @app.post('/api/calculator')
    async def calculate(data: Calculation):
        return ok(await app.state.calculator.calculate(data))

    @app.post('/api/orders')
    @app.post('/api/corporate-orders')
    async def order(request: Request):
        if s.app_env == 'production' and not s.remote_db:
            return fail('Приём заявок временно недоступен. Позвоните диспетчеру.', 503, 'DATABASE_UNAVAILABLE')
        try:
            request_key = str(uuid.UUID(request.headers.get('Idempotency-Key', '')))
        except ValueError:
            return fail('Обновите страницу и повторите отправку', 400, 'INVALID_REQUEST_KEY')
        try:
            async with request.form(max_files=s.max_photos, max_fields=3, max_part_size=32768) as form:
                data = OrderInput.model_validate_json(form.get('payload', '{}'))
                uploads = [f for f in form.getlist('photos') if isinstance(f, UploadFile)]
                images = await app.state.photos.validate(uploads)
        except ValidationError as exc:
            fields = [{'field': '.'.join(map(str, e['loc'])), 'message': e['msg'].removeprefix('Value error, ')} for e in exc.errors()]
            return fail(fields[0]['message'], 422, 'VALIDATION_ERROR', fields)
        except PhotoError as exc:
            return fail(str(exc), 422, 'PHOTO_ERROR')
        if request.url.path == '/api/corporate-orders' and data.type != 'corporate':
            return fail('Неверный тип заявки', 422)
        body = data.model_dump(mode='json')
        fingerprint = hashlib.sha256((json.dumps(body, sort_keys=True, ensure_ascii=False) +
                          ''.join(hashlib.sha256(i).hexdigest() for i in images)).encode()).hexdigest()
        order_id = f'GSS-{datetime.now(timezone.utc).year}-{uuid.uuid4().hex[:12].upper()}'
        calc = None if data.type == 'corporate' else await app.state.calculator.calculate(data)
        loc = data.location
        payload = dict(id=order_id, data=body, calculator=calc, created_at=datetime.now(timezone.utc).isoformat(),
                       photos=app.state.photos.manifest(order_id, images), source='website', consent_version='2026-11-18',
                       map_url=f'https://yandex.ru/maps/?pt={loc.longitude},{loc.latitude}&z=14&l=map' if loc.latitude is not None else None)
        channels = [c for c, enabled in [('telegram', s.telegram_ready), ('email', s.email_ready)] if enabled or s.app_env == 'production']
        try:
            saved, created = await app.state.repo.create(payload, request_key, fingerprint, channels)
        except ConflictError:
            return fail('Данные изменились. Начните новую отправку заявки.', 409, 'IDEMPOTENCY_CONFLICT')
        if saved['status'] in ('awaiting_photos', 'upload_failed'):
            try:
                await app.state.photos.save(saved['id'], saved['payload_json']['photos'], images)
                await app.state.repo.update_order(saved['id'], status='new')
            except Exception:
                await app.state.repo.update_order(saved['id'], status='upload_failed')
                return fail('Не удалось передать фотографии. Повторите отправку.', 503, 'PHOTO_STORAGE_UNAVAILABLE')
        log.info('Order accepted id=%s type=%s', saved['id'], data.type)
        return ok({'order_id': saved['id'], 'accepted': True, 'local_mode': not s.remote_db,
                   'direction': data.direction, 'notifications_connected': bool(channels)}, 201 if created else 200)

    @app.post('/api/chat')
    async def chat(data: ChatInput):
        if not s.deepseek_api_key:
            return ok({'answer': 'Я помогу выбрать нужный раздел. Для ремонта, помощи, эвакуатора или запчастей откройте «Личная заявка». Для автопарка — «Корпоративная заявка». В «Услугах» можно посмотреть направления работ. Свободная консультация появится после подключения консультанта.', 'offline': True})
        prompt = (ROOT / 'app/prompts/website_consultant.txt').read_text(encoding='utf-8')
        prompt += '\nКонтакты компании: ' + json.dumps({'phone': s.company_phone or 'не указан', 'address': s.company_address or 'не указан'}, ensure_ascii=False)
        try:
            result = await app.state.client.post('https://api.deepseek.com/chat/completions', headers={'Authorization': 'Bearer ' + s.deepseek_api_key},
                json={'model': s.deepseek_model, 'messages': [{'role': 'system', 'content': prompt}, {'role': 'user', 'content': data.message}],
                      'max_tokens': 700, 'stream': False}, timeout=40)
            result.raise_for_status()
            return ok({'answer': result.json()['choices'][0]['message']['content']})
        except httpx.HTTPStatusError as exc:
            log.warning('DeepSeek request rejected status=%s', exc.response.status_code)
            message = ('DeepSeek отклонил запрос (HTTP ' + str(exc.response.status_code) + '). '
                       'Проверьте API-ключ, баланс и лимиты.') if s.app_env != 'production' else \
                      'Консультант сейчас недоступен. Можно оставить заявку или позвонить.'
            return fail(message, 503, 'CHAT_UNAVAILABLE')
        except (httpx.HTTPError, KeyError, IndexError, ValueError) as exc:
            log.warning('DeepSeek request failed error=%s', type(exc).__name__)
            message = ('Не удалось подключиться к DeepSeek (' + type(exc).__name__ + '). '
                       'Проверьте интернет и доступ к api.deepseek.com.') if s.app_env != 'production' else \
                      'Консультант сейчас недоступен. Можно оставить заявку или позвонить.'
            return fail(message, 503, 'CHAT_UNAVAILABLE')

    @app.post('/api/telegram/webhook')
    async def webhook(request: Request):
        supplied = request.headers.get('X-Telegram-Bot-Api-Secret-Token', '')
        if not s.telegram_webhook_secret or not hmac.compare_digest(supplied, s.telegram_webhook_secret):
            return fail('Forbidden', 403)
        await app.state.notifications.complete(await request.json())
        return {'ok': True}

    return app

app = create_app()

