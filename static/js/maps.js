import {toast} from './ui.js';

let mapsPromise;

function loadMaps(key) {
  if (!mapsPromise) {
    mapsPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://api-maps.yandex.ru/2.1/?apikey=' + encodeURIComponent(key) + '&lang=ru_RU';
      script.onload = () => window.ymaps
        ? window.ymaps.ready(() => resolve(window.ymaps))
        : reject(new Error('Не удалось загрузить карту'));
      script.onerror = () => {
        mapsPromise = null;
        script.remove();
        reject(new Error('Карта недоступна. Укажите адрес или координаты вручную.'));
      };
      setTimeout(() => reject(new Error('Карта не ответила. Укажите адрес или координаты вручную.')), 15000);
      document.head.append(script);
    });
  }
  return mapsPromise;
}

export function initMaps(config, form) {
  const lat = form.elements.latitude;
  const lon = form.elements.longitude;
  const address = form.elements.address;
  const status = document.querySelector('#map-status');
  const container = document.querySelector('#selection-map');
  let map;
  let marker;

  function setPoint(point) {
    lat.value = Number(point[0]).toFixed(6);
    lon.value = Number(point[1]).toFixed(6);
    if (marker) marker.geometry.setCoordinates(point);
    if (map) map.setCenter(point, 13);
    form.dispatchEvent(new Event('input', {bubbles: true}));
    status.textContent = 'Точка выбрана. Координаты попадут в заявку.';
  }

  function createMap(ymaps) {
    const point = lat.value !== '' && lon.value !== ''
      ? [Number(lat.value), Number(lon.value)]
      : config.center || [55.75, 37.62];
    map = new ymaps.Map(container, {
      center: point,
      zoom: lat.value !== '' ? 12 : config.center ? 9 : 3,
      controls: ['zoomControl'],
    });
    marker = new ymaps.Placemark(point, {}, {
      draggable: true,
      preset: 'islands#redDotIcon',
    });
    map.geoObjects.add(marker);
    map.events.add('click', event => setPoint(event.get('coords')));
    marker.events.add('dragend', () => setPoint(marker.geometry.getCoordinates()));
  }

  async function openMap() {
    if (!config.maps_key) {
      toast('Карта пока не подключена. Можно указать адрес или координаты.');
      return null;
    }
    container.hidden = false;
    status.textContent = 'Загружаем карту…';
    try {
      const ymaps = await loadMaps(config.maps_key);
      if (!map) createMap(ymaps);
      else map.container.fitToViewport();
      status.textContent = 'Нажмите на карту, чтобы выбрать точку. Красную метку можно перемещать.';
      return ymaps;
    } catch (error) {
      container.hidden = true;
      status.textContent = error.message;
      return null;
    }
  }

  document.querySelector('#locate').addEventListener('click', () => {
    if (!navigator.geolocation) {
      status.textContent = 'Геолокация недоступна. Укажите адрес вручную.';
      return;
    }
    status.textContent = 'Определяем местоположение…';
    navigator.geolocation.getCurrentPosition(
      position => setPoint([position.coords.latitude, position.coords.longitude]),
      () => { status.textContent = 'Местоположение не получено. Введите адрес или выберите точку на карте.'; },
      {enableHighAccuracy: true, timeout: 12000, maximumAge: 60000},
    );
  });

  document.querySelector('#show-map').addEventListener('click', () => openMap());
  document.querySelector('#find-address').addEventListener('click', async () => {
    const query = address.value.trim();
    if (!query) {
      status.textContent = 'Сначала введите адрес для поиска.';
      address.focus();
      return;
    }
    const ymaps = await openMap();
    if (!ymaps) return;
    status.textContent = 'Ищем адрес…';
    try {
      const result = await ymaps.geocode(query, {results: 1});
      const geoObject = result.geoObjects.get(0);
      if (!geoObject) throw new Error('Адрес не найден');
      setPoint(geoObject.geometry.getCoordinates());
      const formatted = geoObject.properties.get('text');
      if (formatted) address.value = formatted;
    } catch {
      status.textContent = 'Адрес не найден. Уточните запрос или выберите точку на карте вручную.';
    }
  });

  const home = document.querySelector('#company-map');
  if (config.center) {
    home.classList.remove('map-placeholder');
    home.replaceChildren();
    const iframe = document.createElement('iframe');
    const [latitude, longitude] = config.center;
    iframe.src = `https://yandex.ru/map-widget/v1/?ll=${longitude}%2C${latitude}&z=14&pt=${longitude}%2C${latitude}%2Cpm2rdm`;
    iframe.title = 'Расположение ГрузСпецСервис на Яндекс Картах';
    iframe.loading = 'lazy';
    iframe.allow = 'geolocation';
    iframe.referrerPolicy = 'strict-origin-when-cross-origin';
    home.append(iframe);
  }
}
// new