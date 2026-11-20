"""The same durable outbox contract for local SQLite and Supabase REST."""
import asyncio
import json
import sqlite3
import time
from pathlib import Path


class ConflictError(Exception):
    pass


class Repository:
    def __init__(self, settings, client):
        self.settings, self.client = settings, client
        self.remote = settings.remote_db
        self.lock = asyncio.Lock()
        if not self.remote:
            Path(settings.database_path).parent.mkdir(parents=True, exist_ok=True)
            self.db = sqlite3.connect(settings.database_path, check_same_thread=False)
            self.db.row_factory = sqlite3.Row
            self.db.executescript('''
                PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS orders (
                  id TEXT PRIMARY KEY, request_key TEXT UNIQUE NOT NULL, fingerprint TEXT NOT NULL,
                  payload_json TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'awaiting_photos',
                  photos_cleaned INTEGER NOT NULL DEFAULT 0, completed_at REAL, completed_by TEXT);
                CREATE TABLE IF NOT EXISTS notification_logs (
                  id INTEGER PRIMARY KEY, order_id TEXT NOT NULL, channel TEXT NOT NULL,
                  status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
                  next_at REAL NOT NULL DEFAULT 0, leased_until REAL NOT NULL DEFAULT 0,
                  progress TEXT NOT NULL DEFAULT '{}', last_error TEXT,
                  UNIQUE(order_id,channel));
            ''')

    async def rest(self, method, resource, **kwargs):
        headers = {'apikey': self.settings.supabase_key, 'Authorization': 'Bearer ' + self.settings.supabase_key,
                   'Prefer': 'return=representation'}
        response = await self.client.request(method, self.settings.supabase_url.rstrip('/') + '/rest/v1/' + resource,
                                             headers=headers, timeout=15, **kwargs)
        response.raise_for_status()
        return response.json() if response.content else None

    @staticmethod
    def decode(row):
        row = dict(row)
        for key in ('payload_json', 'progress'):
            if key in row and isinstance(row[key], str):
                row[key] = json.loads(row[key])
        return row

    async def get(self, order_id):
        if self.remote:
            rows = await self.rest('GET', 'orders', params={'id': 'eq.' + order_id, 'limit': '1'})
            return rows[0] if rows else None
        row = self.db.execute('SELECT * FROM orders WHERE id=?', (order_id,)).fetchone()
        return self.decode(row) if row else None

    async def create(self, payload, request_key, fingerprint, channels):
        if self.remote:
            result = await self.rest('POST', 'rpc/create_order', json={
                'p_payload': payload, 'p_request_key': request_key, 'p_fingerprint': fingerprint, 'p_channels': channels})
            if result.get('conflict'):
                raise ConflictError()
            return result['order'], result['created']
        async with self.lock:
            existing = self.db.execute('SELECT * FROM orders WHERE request_key=?', (request_key,)).fetchone()
            if existing:
                if existing['fingerprint'] != fingerprint:
                    raise ConflictError()
                return self.decode(existing), False
            with self.db:
                self.db.execute('INSERT INTO orders(id,request_key,fingerprint,payload_json) VALUES(?,?,?,?)',
                                (payload['id'], request_key, fingerprint, json.dumps(payload, ensure_ascii=False)))
                for channel in ('telegram', 'email'):
                    self.db.execute('INSERT INTO notification_logs(order_id,channel,status) VALUES(?,?,?)',
                                    (payload['id'], channel, 'pending' if channel in channels else 'skipped'))
            return await self.get(payload['id']), True

    async def update_order(self, order_id, **values):
        if self.remote:
            await self.rest('PATCH', 'orders', params={'id': 'eq.' + order_id}, json=values)
        else:
            with self.db:
                self.db.execute('UPDATE orders SET ' + ','.join(k + '=?' for k in values) + ' WHERE id=?',
                                (*values.values(), order_id))

    async def claim(self):
        if self.remote:
            return await self.rest('POST', 'rpc/claim_notifications', json={})
        async with self.lock:
            now = time.time()
            rows = self.db.execute('''SELECT n.* FROM notification_logs n JOIN orders o ON n.order_id=o.id
              WHERE o.status NOT IN ('awaiting_photos','upload_failed') AND n.status NOT IN ('sent','skipped')
              AND n.next_at<=? AND n.leased_until<? ORDER BY n.id LIMIT 2''', (now, now)).fetchall()
            with self.db:
                for row in rows:
                    self.db.execute("UPDATE notification_logs SET status='processing',leased_until=?,attempts=attempts+1 WHERE id=?",
                                    (now + 300, row['id']))
            return [dict(self.decode(row), attempts=row['attempts'] + 1) for row in rows]

    async def update_job(self, job_id, **values):
        if self.remote:
            # Database timestamps use numeric Unix seconds consistently across both adapters.
            await self.rest('PATCH', 'notification_logs', params={'id': 'eq.' + str(job_id)}, json=values)
        else:
            values = {k: json.dumps(v) if k == 'progress' else v for k, v in values.items()}
            with self.db:
                self.db.execute('UPDATE notification_logs SET ' + ','.join(k + '=?' for k in values) + ' WHERE id=?',
                                (*values.values(), job_id))

    async def jobs(self, order_id):
        if self.remote:
            return await self.rest('GET', 'notification_logs', params={'order_id': 'eq.' + order_id, 'order': 'id.asc'})
        return [self.decode(r) for r in self.db.execute('SELECT * FROM notification_logs WHERE order_id=? ORDER BY id', (order_id,))]

    async def cleanup_candidates(self):
        if self.remote:
            return await self.rest('POST', 'rpc/cleanup_candidates', json={})
        return [self.decode(r) for r in self.db.execute("""SELECT o.* FROM orders o WHERE photos_cleaned=0
            AND status NOT IN ('awaiting_photos','upload_failed') AND NOT EXISTS (
              SELECT 1 FROM notification_logs n WHERE n.order_id=o.id AND n.status NOT IN ('sent','skipped')) LIMIT 20""")]

    async def stats(self):
        if self.remote:
            result = await self.rest('POST', 'rpc/public_stats', json={})
            return result
        done = self.db.execute("SELECT count(*) FROM orders WHERE status='completed'").fetchone()[0]
        return {'completed_orders': done, 'years': self.settings.company_years, 'source': 'local'}

    def close(self):
        if not self.remote:
            self.db.close()
