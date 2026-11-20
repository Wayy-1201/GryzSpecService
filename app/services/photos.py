import asyncio
import hashlib
import io
import re
import shutil
import warnings
from pathlib import Path
from PIL import Image, ImageOps, UnidentifiedImageError
from app.config import ROOT


class PhotoError(ValueError):
    pass


def normalize_photo(raw):
    try:
        with warnings.catch_warnings():
            warnings.simplefilter('error', Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(raw)) as original:
                if original.format not in {'JPEG', 'PNG', 'WEBP'}:
                    raise PhotoError('Допустимы только JPEG, PNG и WebP')
                if original.width * original.height > 30_000_000:
                    raise PhotoError('Слишком большое разрешение фотографии')
                image = ImageOps.exif_transpose(original)
                image.thumbnail((1920, 1920))
                image = image.convert('RGB')
                output = io.BytesIO()
                image.save(output, 'JPEG', quality=85, optimize=True)
                return output.getvalue()
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError, Image.DecompressionBombWarning) as exc:
        raise PhotoError('Файл не является допустимой фотографией') from exc


class Photos:
    def __init__(self, settings, client):
        self.settings, self.client = settings, client
        self.root = ROOT / 'photo'

    def folder(self, order_id):
        if not re.fullmatch(r'GSS-\d{4}-[A-F0-9]{12}', order_id):
            raise ValueError('Invalid order id')
        return self.root / order_id

    async def validate(self, uploads):
        if len(uploads) > self.settings.max_photos:
            raise PhotoError(f'Не больше {self.settings.max_photos} фотографий')
        result = []
        for upload in uploads:
            raw = await upload.read(self.settings.max_upload_mb * 1024 * 1024 + 1)
            if len(raw) > self.settings.max_upload_mb * 1024 * 1024:
                raise PhotoError(f'Фотография должна быть не больше {self.settings.max_upload_mb} МБ')
            result.append(await asyncio.to_thread(normalize_photo, raw))
        return result

    def manifest(self, order_id, images):
        return [dict(filename=f'photo-{i + 1}.jpg', key=f'{order_id}/photo-{i + 1}.jpg',
                     sha256=hashlib.sha256(raw).hexdigest(), size=len(raw)) for i, raw in enumerate(images)]

    def headers(self):
        return {'apikey': self.settings.supabase_key, 'Authorization': 'Bearer ' + self.settings.supabase_key}

    def url(self, key=''):
        return self.settings.supabase_url.rstrip('/') + '/storage/v1/object/' + self.settings.supabase_photo_bucket + ('/' + key if key else '')

    async def save(self, order_id, manifest, images):
        if not images:
            return
        folder = self.folder(order_id)
        folder.mkdir(parents=True, exist_ok=True)
        for item, raw in zip(manifest, images):
            await asyncio.to_thread((folder / item['filename']).write_bytes, raw)
            if self.settings.remote_db:
                response = await self.client.post(self.url(item['key']), content=raw,
                    headers={**self.headers(), 'Content-Type': 'image/jpeg', 'x-upsert': 'true'}, timeout=30)
                response.raise_for_status()

    async def read(self, item):
        # Keys are server generated and come only from the canonical database record.
        order_id, filename = item['key'].split('/')
        local = self.folder(order_id) / filename
        if filename != Path(filename).name:
            raise ValueError('Invalid photo path')
        if local.exists():
            return await asyncio.to_thread(local.read_bytes)
        response = await self.client.get(self.url(item['key']), headers=self.headers(), timeout=30)
        response.raise_for_status()
        return response.content

    async def delete(self, order):
        manifest = order['payload_json']['photos']
        if self.settings.remote_db and manifest:
            response = await self.client.request('DELETE', self.url(), headers=self.headers(),
                                                 json={'prefixes': [p['key'] for p in manifest]}, timeout=20)
            response.raise_for_status()
        folder = self.folder(order['id'])
        if folder.exists():
            await asyncio.to_thread(shutil.rmtree, folder)
