SERVICES = [
    dict(id='repair', title='Ремонт на СТО', icon='wrench', direction='sto', price=10000,
         description='Техническое обслуживание и ремонт грузовиков, прицепов и спецтехники.',
         details=['Двигатель и система охлаждения', 'КПП, сцепление и трансмиссия', 'Подвеска, тормоза и пневмосистема']),
    dict(id='diagnostics', title='Диагностика', icon='activity', direction='sto', price=3500,
         description='Найдём причину неисправности и согласуем дальнейшие работы.',
         details=['Компьютерная диагностика', 'Проверка узлов и оборудования', 'Диагностика перед покупкой']),
    dict(id='electric', title='Автоэлектрик', icon='zap', direction='autoelectrician', price=5000,
         description='Проводка, электрооборудование, запуск двигателя и электронные системы.',
         details=['Поиск неисправностей проводки', 'Освещение и электропитание', 'Датчики и блоки управления']),
    dict(id='help', title='Помощь на дороге', icon='truck', direction='help', price=10000,
         description='Выезд к месту поломки. Передадим диспетчеру координаты и описание проблемы.',
         details=['Выездной ремонт', 'Диагностика на месте', 'Помощь при проблемах с запуском']),
    dict(id='towing', title='Грузовой эвакуатор', icon='move', direction='help', price=15000,
         description='Заявка на перевозку неисправного транспорта. Маршрут согласуем с вами.',
         details=['Грузовые автомобили', 'Прицепная техника', 'Согласование маршрута и условий']),
    dict(id='parts', title='Подбор запчастей', icon='box', direction='sto', price=None,
         description='Опишите деталь, укажите артикул или приложите фото - уточним подбор и наличие.',
         details=['Подбор по марке и модели', 'Заявка по артикулу', 'Стоимость по запросу']),
]
import json
from app.config import ROOT

# One tariff source for both catalogue and server-side calculation.
_prices = json.loads((ROOT / 'config/pricing.json').read_text(encoding='utf-8'))['service_prices']
for _service in SERVICES:
    _service['price'] = _prices[_service['id']]
SERVICE_MAP = {s['id']: s for s in SERVICES}
