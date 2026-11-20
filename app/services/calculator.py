import json
import math
import time
import httpx
from app.config import ROOT


class Calculator:
    def __init__(self, settings, client):
        self.settings, self.client = settings, client
        self.prices = json.loads((ROOT / 'config/pricing.json').read_text(encoding='utf-8'))
        self.cache = {}

    async def distance(self, location):
        center = self.settings.center
        if not center or location.latitude is None:
            return None, 'unavailable'
        target = [location.latitude, location.longitude]
        key = tuple(round(v, 4) for v in center + target)
        cached = self.cache.get(key)
        if cached and cached[0] > time.monotonic():
            return cached[1]
        result = None
        if self.settings.yandex_routing_api_key:
            try:
                response = await self.client.get('https://api.routing.yandex.net/v2/distancematrix', params={
                    'apikey': self.settings.yandex_routing_api_key,
                    'origins': ','.join(map(str, center)), 'destinations': ','.join(map(str, target)), 'mode': 'driving'}, timeout=8)
                response.raise_for_status()
                route = response.json()['rows'][0]['elements'][0]
                if route['status'] == 'OK':
                    result = (round(route['distance']['value'] / 1000, 1), 'road')
            except (httpx.HTTPError, KeyError, IndexError, ValueError):
                pass
        if result is None:
            lat1, lat2 = map(math.radians, [center[0], target[0]])
            dlat, dlon = lat2 - lat1, math.radians(target[1] - center[1])
            a = math.sin(dlat / 2)**2 + math.cos(lat1)*math.cos(lat2)*math.sin(dlon / 2)**2
            km = 6371 * 2 * math.asin(math.sqrt(min(1, a)))
            result = (round(km * self.prices['road_factor'], 1), 'approximate')
        if len(self.cache) > 500:
            self.cache.clear()
        self.cache[key] = (time.monotonic() + 300, result)
        return result

    async def calculate(self, data):
        p = self.prices
        km, source = await self.distance(data.location) if data.visit else (None, 'not_needed')
        individual = data.service == 'parts' or (km is not None and km > p['individual_quote_after_km'])
        work = p['service_prices'][data.service]
        if work is not None:
            work = math.ceil(work * p['vehicle_multipliers'][data.vehicle_type] / 100) * 100
        travel = 0
        if data.visit:
            travel = p['visit_base'] + max(0, (km or 0) - p['included_km']) * p['price_per_km']
            travel = math.ceil(travel / 100) * 100
        total = math.ceil(((work or 0) + travel) * (p['urgent_multiplier'] if data.urgent else 1) / 100) * 100
        return dict(work_from=work, visit_from=travel, total_from=None if individual else total,
                    distance_km=km, distance_source=source, individual=individual,
                    distance_pending=data.visit and km is None,
                    note='Точную стоимость диспетчер согласует после уточнения маршрута и диагностики.',
                    pricing_version='2026-11-18')
