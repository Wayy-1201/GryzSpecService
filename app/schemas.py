import re
from typing import Literal
from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator, model_validator


class InputModel(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)


class Location(InputModel):
    address: str = Field(default='', max_length=500)
    latitude: float | None = Field(default=None, ge=-90, le=90, allow_inf_nan=False)
    longitude: float | None = Field(default=None, ge=-180, le=180, allow_inf_nan=False)

    @model_validator(mode='after')
    def coordinate_pair(self):
        if (self.latitude is None) != (self.longitude is None):
            raise ValueError('Укажите обе координаты')
        return self


class Calculation(InputModel):
    service: str = 'repair'
    vehicle_type: Literal['truck', 'trailer', 'special', 'bus'] = 'truck'
    visit: bool = False
    urgent: bool = False
    location: Location = Field(default_factory=Location)

    @field_validator('service')
    @classmethod
    def known_service(cls, value):
        from app.catalog import SERVICE_MAP
        if value not in SERVICE_MAP:
            raise ValueError('Выберите услугу из списка')
        return value

    @model_validator(mode='after')
    def service_requires_visit(self):
        if self.service in ('help', 'towing'):
            self.visit = True
        return self


class OrderInput(Calculation):
    type: Literal['personal', 'corporate'] = 'personal'
    direction: Literal['sto', 'autoelectrician', 'help', 'corporate'] = 'sto'
    name: str = Field(min_length=2, max_length=100)
    phone: str
    email: EmailStr | None = None
    brand: str = Field(default='', max_length=100)
    model: str = Field(default='', max_length=100)
    description: str = Field(min_length=5, max_length=3000)
    comments: str = Field(default='', max_length=1500)
    company: str = Field(default='', max_length=200)
    inn: str = Field(default='', max_length=12)
    fleet_size: int | None = Field(default=None, ge=1, le=100000)
    consent: bool
    website: str = Field(default='', max_length=200)

    @field_validator('phone')
    @classmethod
    def normalize_phone(cls, value):
        digits = re.sub(r'\D', '', value)
        if len(digits) == 11 and digits[0] in '78':
            return '+7' + digits[1:]
        raise ValueError('Укажите российский номер из 11 цифр, начиная с +7')

    @field_validator('inn')
    @classmethod
    def valid_inn(cls, value):
        if value and not re.fullmatch(r'(\d{10}|\d{12})', value):
            raise ValueError('ИНН должен содержать 10 или 12 цифр')
        return value

    @model_validator(mode='after')
    def business_rules(self):
        if not self.consent:
            raise ValueError('Необходимо согласие на обработку персональных данных')
        if self.website:
            raise ValueError('Не удалось принять заявку')
        if self.type == 'corporate':
            self.direction = 'corporate'
            if not self.company or not self.fleet_size or not self.email:
                raise ValueError('Укажите компанию, email и количество автомобилей')
        else:
            from app.catalog import SERVICE_MAP
            self.direction = 'help' if self.visit else SERVICE_MAP[self.service]['direction']
            if not self.brand:
                raise ValueError('Укажите марку транспорта')
            if self.visit:
                if not self.location.address and self.location.latitude is None:
                    raise ValueError('Укажите адрес или точку на карте')
        return self


class ChatInput(InputModel):
    message: str = Field(min_length=1, max_length=2000)
