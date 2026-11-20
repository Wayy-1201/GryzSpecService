from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import field_validator

ROOT = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=ROOT / '.env', extra='ignore', env_file_encoding='utf-8')
    app_env: str = 'development'
    public_url: str = 'http://localhost:8000'
    database_path: str = str(ROOT / 'data' / 'local.db')
    supabase_url: str = ''
    supabase_key: str = ''
    supabase_photo_bucket: str = 'order-photos'
    company_phone: str = ''
    company_address: str = ''
    company_email: str = ''
    company_latitude: float | None = None
    company_longitude: float | None = None
    company_years: int | None = None
    telegram_url: str = ''
    max_url: str = ''
    telegram_bot_token: str = ''
    telegram_chat_id: str = ''
    telegram_webhook_secret: str = ''
    telegram_manager_ids: str = ''
    mail_transport: str = 'resend'
    smtp_host: str = ''
    smtp_port: int = 587
    smtp_user: str = ''
    smtp_password: str = ''
    smtp_from: str = ''
    smtp_ssl: bool = False
    manager_email: str = ''
    resend_api_key: str = ''
    deepseek_api_key: str = ''
    deepseek_model: str = 'deepseek-chat'
    yandex_maps_api_key: str = ''
    yandex_routing_api_key: str = ''
    yandex_org_id: str = ''
    privacy_file: str = str(ROOT / 'content' / 'privacy.txt')
    worker_enabled: bool = True
    max_upload_mb: int = 8
    max_photos: int = 5

    @field_validator('company_latitude', 'company_longitude', 'company_years', mode='before')
    @classmethod
    def optional_number(cls, value):
        return None if value == '' else value

    @property
    def remote_db(self):
        return bool(self.supabase_url and self.supabase_key)

    @property
    def telegram_ready(self):
        return bool(self.telegram_bot_token and self.telegram_chat_id)

    @property
    def email_ready(self):
        return bool(self.manager_email and self.smtp_from and (
            self.resend_api_key if self.mail_transport == 'resend' else self.smtp_host))

    @property
    def center(self):
        if self.company_latitude is not None and self.company_longitude is not None:
            return [self.company_latitude, self.company_longitude]
        return None

    def public(self):
        return dict(phone=self.company_phone, address=self.company_address,
                    email=self.company_email, center=self.center, hours='Круглосуточно, 24/7',
                    telegram_url=self.telegram_url, max_url=self.max_url,
                    maps_key=self.yandex_maps_api_key, org_id=self.yandex_org_id,
                    years=self.company_years,
                    local_mode=not self.remote_db, max_photos=self.max_photos,
                    max_upload_mb=self.max_upload_mb)
