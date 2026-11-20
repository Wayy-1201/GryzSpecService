import { api } from './api.js';
import { money } from './ui.js';

export function initCalculator(form, getData, services) {
	const mobile = matchMedia('(max-width: 760px)');
	const disclosure = document.querySelector('.estimate-disclosure');

	disclosure.open = !mobile.matches;
	mobile.addEventListener('change', () => {
		disclosure.open = !mobile.matches;
	});

	let timer;
	let revision = 0;

	const visitInput = form.querySelector('[name="visit"], #visit');
	const urgentInput = form.querySelector('[name="urgent"], #urgent');
	const urgentBox =
		urgentInput?.closest('label, .field, .checkbox, .form-field') ||
		urgentInput;

	function syncUrgentVisibility() {
		const show = Boolean(visitInput?.checked);

		if (urgentBox) {
			urgentBox.hidden = !show;
		}

		if (!show && urgentInput?.checked) {
			urgentInput.checked = false;
			urgentInput.dispatchEvent(new Event('change', { bubbles: true }));
		}
	}

	visitInput?.addEventListener('change', syncUrgentVisibility);
	document.addEventListener('gss:calculation', syncUrgentVisibility);
	syncUrgentVisibility();

	async function update() {
		const currentRevision = ++revision;
		const data = getData();

		document.querySelector('#estimate-service').textContent =
			services.find(item => item.id === data.service)?.title || '';

		try {
			const result = await api('calculator', {
				method: 'POST',
				body: data,
			});

			// Не применяем устаревший ответ, если за время запроса данные изменились.
			if (currentRevision !== revision) {
				return;
			}

			document.querySelector('#estimate-total').textContent =
				result.individual ? 'Индивидуально' : `от ${money(result.total_from)}`;

			document.querySelector('#estimate-work').textContent =
				result.work_from === null
					? 'По запросу'
					: `от ${money(result.work_from)}`;

			document.querySelector('#estimate-travel').textContent = data.visit
				? `от ${money(result.visit_from)}`
				: 'Не нужен';

			const distanceTypes = {
				road: 'по дороге',
				approximate: 'оценка',
			};

			document.querySelector('#estimate-distance').textContent =
				result.distance_km === null
					? data.visit
						? 'Уточним маршрут'
						: '—'
					: `${result.distance_km.toLocaleString('ru-RU')} км · ${
							distanceTypes[result.distance_source]
						}`;

			document.querySelector('#estimate-note').textContent =
				(result.distance_pending
					? 'Стоимость выезда предварительная: расстояние ещё не учтено. '
					: result.distance_source === 'approximate'
						? 'Расстояние оценено по прямой с поправкой на дорогу. '
						: '') + result.note;
		} catch (error) {
			if (currentRevision === revision) {
				document.querySelector('#estimate-total').textContent =
					'Уточним стоимость';
				document.querySelector('#estimate-note').textContent =
					error.message;
			}
		}
	}

	const compact = document.querySelector('#estimate-compact');
	const total = document.querySelector('#estimate-total');

	new MutationObserver(() => {
		compact.textContent = total.textContent;
	}).observe(total, { childList: true });

	function schedule() {
		clearTimeout(timer);
		timer = setTimeout(update, 350);
	}

	function immediate() {
		clearTimeout(timer);
		update();
	}

	form.addEventListener('input', schedule);
	form.addEventListener('change', immediate);
	document.addEventListener('gss:calculation', immediate);

	update();
}