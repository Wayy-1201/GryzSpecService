import { api } from './api.js';
import { el, icon, toast, money } from './ui.js';
import { navigate } from './navigation.js';
import { initCalculator } from './calculator.js';
import { initMaps } from './maps.js';

export function initForms(config, services) {
	const personal = document.querySelector('#personal-form');
	const corporate = document.querySelector('#corporate-form');
	const picker = document.querySelector('#service-picker');

	let service = services[0].id;

	const files = new Map([
		[personal, []],
		[corporate, []],
	]);
	const keys = new WeakMap();
	const previews = new WeakMap();

	function selected() {
		return services.find(item => item.id === service);
	}

	function setService(id, open = false) {
		if (!services.some(item => item.id === id)) {
			return;
		}

		service = id;

		picker.querySelectorAll('button').forEach(button => {
			button.setAttribute(
				'aria-pressed',
				String(button.dataset.service === id)
			);
		});

		const forcedVisit = selected().direction === 'help';
		personal.elements.visit.checked = forcedVisit;
		personal.elements.visit.disabled = forcedVisit;

		toggleLocation();
		document.dispatchEvent(new Event('gss:calculation'));
		keys.delete(personal);

		if (open) {
			navigate('personal');
		}
	}

	function toggleLocation() {
		document.querySelector('#location-fields').hidden =
			!personal.elements.visit.checked;
	}

	for (const [index, item] of services.entries()) {
		const button = el('button', '', item.title);

		button.type = 'button';
		button.dataset.service = item.id;
		button.prepend(icon(item.icon));
		button.setAttribute('aria-pressed', String(index === 0));
		button.addEventListener('click', () => setService(item.id));
		picker.append(button);

		const card = el('article', 'service-card');
		const top = el('div', 'service-card-top');
		const list = el('ul');
		const action = el(
			'button',
			'',
			item.price === null ? 'Уточнить стоимость' : `от ${money(item.price)}`
		);

		top.append(icon(item.icon), el('span', '', String(index + 1).padStart(2, '0')));

		item.details.forEach(detail => {
			list.append(el('li', '', detail));
		});

		action.append(icon('arrow'));
		action.addEventListener('click', () => setService(item.id, true));

		card.append(
			top,
			el('h2', '', item.title),
			el('p', '', item.description),
			list,
			action
		);

		document.querySelector('#services-grid').append(card);
	}

	document
		.querySelectorAll('[data-service]:not(#service-picker button)')
		.forEach(button => {
			button.addEventListener('click', () => {
				setService(button.dataset.service, true);
			});
		});

	personal.elements.visit.addEventListener('change', toggleLocation);

	function calculation() {
		const fields = personal.elements;

		return {
			service,
			vehicle_type: fields.vehicle_type.value,
			visit: fields.visit.checked,
			urgent: fields.urgent.checked,
			location: {
				address: fields.address.value,
				latitude:
					fields.latitude.value === ''
						? null
						: Number(fields.latitude.value),
				longitude:
					fields.longitude.value === ''
						? null
						: Number(fields.longitude.value),
			},
		};
	}

	initCalculator(personal, calculation, services);
	initMaps(config, personal);

	function phoneMask(input) {
		input.addEventListener('input', () => {
			let digits = input.value.replace(/\D/g, '');

			if (digits.startsWith('8') || digits.startsWith('7')) {
				digits = digits.slice(1);
			}

			digits = digits.slice(0, 10);

			let value = '+7';

			if (digits.length) {
				value += ` (${digits.slice(0, 3)}`;
			}

			if (digits.length >= 3) {
				value += ') ';
			}

			if (digits.length > 3) {
				value += digits.slice(3, 6);
			}

			if (digits.length > 6) {
				value += `-${digits.slice(6, 8)}`;
			}

			if (digits.length > 8) {
				value += `-${digits.slice(8)}`;
			}

			input.value = value;
		});

		input.addEventListener('blur', () => {
			if (input.value === '+7') {
				input.value = '';
			}
		});
	}

	function revokePreviews(form) {
		(previews.get(form) || []).forEach(url => URL.revokeObjectURL(url));
		previews.set(form, []);
	}

	function renderPhotos(form) {
		const box = form.querySelector('.photo-previews');

		if (!box) {
			return;
		}

		revokePreviews(form);
		box.replaceChildren();

		const urls = [];

		files.get(form).forEach((file, index) => {
			const url = URL.createObjectURL(file);
			const item = el('div', 'photo-preview');
			const image = el('img');
			const button = el('button');

			urls.push(url);

			image.src = url;
			image.alt = `Фото ${index + 1}`;

			button.type = 'button';
			button.setAttribute('aria-label', `Удалить фото ${index + 1}`);
			button.append(icon('close'));
			button.addEventListener('click', () => {
				files.get(form).splice(index, 1);
				keys.delete(form);
				renderPhotos(form);
			});

			item.append(image, button);
			box.append(item);
		});

		previews.set(form, urls);
	}

	function payload(form) {
		const fields = form.elements;
		const isCorporate = form === corporate;

		return {
			...(isCorporate
				? {
						service: 'repair',
						vehicle_type: fields.vehicle_type.value,
						visit: false,
						urgent: false,
						location: {
							address: '',
							latitude: null,
							longitude: null,
						},
					}
				: calculation()),
			type: isCorporate ? 'corporate' : 'personal',
			direction: isCorporate ? 'corporate' : selected().direction,
			name: fields.name.value,
			phone: fields.phone.value,
			email: fields.email.value.trim() || null,
			brand: isCorporate ? '' : fields.brand.value,
			model: isCorporate ? '' : fields.model.value,
			description: fields.description.value,
			comments: fields.comments.value,
			company: isCorporate ? fields.company.value : '',
			inn: isCorporate ? fields.inn.value : '',
			fleet_size: isCorporate ? Number(fields.fleet_size.value) : null,
			consent: fields.consent.checked,
			website: fields.website.value,
		};
	}

	function validation(form) {
		form.querySelectorAll('[aria-invalid]').forEach(input => {
			input.removeAttribute('aria-invalid');
		});

		const invalid = [...form.elements].find(
			input => input.willValidate && !input.checkValidity()
		);

		if (invalid) {
			invalid.setAttribute('aria-invalid', 'true');
			invalid.focus();
			invalid.reportValidity();

			return 'Заполните обязательные поля и проверьте введённые данные.';
		}

		if (form.elements.phone.value.replace(/\D/g, '').length !== 11) {
			form.elements.phone.focus();
			form.elements.phone.setAttribute('aria-invalid', 'true');

			return 'Укажите телефон полностью: +7 и 10 цифр номера.';
		}

		if (form === personal && personal.elements.visit.checked) {
			const fields = personal.elements;
			const hasOneCoordinate =
				(fields.latitude.value === '') !== (fields.longitude.value === '');

			if (hasOneCoordinate) {
				return 'Укажите обе координаты или оставьте их пустыми.';
			}

			const needsAddress =
				selected().direction === 'help' &&
				!fields.address.value.trim() &&
				fields.latitude.value === '';

			if (needsAddress) {
				fields.address.focus();
				return 'Укажите адрес или выберите точку для выезда.';
			}
		}

		return null;
	}

	for (const form of [personal, corporate]) {
		phoneMask(form.elements.phone);

		form.addEventListener('input', () => keys.delete(form));
		form.addEventListener('change', () => keys.delete(form));

		const upload = form.elements.photos;

		if (upload) {
			upload.addEventListener('change', () => {
				let error = '';

				for (const file of upload.files) {
					if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
						error = 'Принимаем фотографии JPG, PNG и WebP.';
						continue;
					}

					if (file.size > config.max_upload_mb * 1024 * 1024) {
						error = `Размер одного фото — до ${config.max_upload_mb} МБ.`;
						continue;
					}

					if (files.get(form).length >= config.max_photos) {
						error = `Можно добавить до ${config.max_photos} фотографий.`;
						break;
					}

					files.get(form).push(file);
				}

				if (error) {
					toast(error);
				}

				upload.value = '';
				renderPhotos(form);
			});
		}

		form.addEventListener('submit', async event => {
			event.preventDefault();

			const error = form.querySelector('.form-error');
			error.hidden = true;

			const issue = validation(form);

			if (issue) {
				error.textContent = issue;
				error.hidden = false;
				return;
			}

			const button = form.querySelector('[type=submit]');
			const label = button.cloneNode(true);

			button.disabled = true;
			button.textContent = 'Сохраняем заявку…';

			const data = new FormData();
			data.append('payload', JSON.stringify(payload(form)));

			files.get(form).forEach(file => {
				data.append('photos', file);
			});

			if (!keys.has(form)) {
				keys.set(form, crypto.randomUUID());
			}

			try {
				const result = await api(
					form === corporate ? 'corporate-orders' : 'orders',
					{
						method: 'POST',
						body: data,
						headers: {
							'Idempotency-Key': keys.get(form),
						},
					}
				);

				const dialog = document.querySelector('#success-dialog');
				const call = document.querySelector('#success-call');

				document.querySelector('#success-id').textContent = result.order_id;
				document.querySelector('#success-title').textContent =
					result.local_mode
						? 'Заявка сохранена локально.'
						: 'Заявка принята.';

				document.querySelector('#success-message').textContent =
					result.local_mode
						? 'Сейчас включён режим разработки. Заявка сохранена на этом компьютере' +
							(result.notifications_connected
								? ' и поставлена в очередь отправки.'
								: ', отправка менеджеру ещё не подключена.')
						: result.direction === 'help'
							? 'Теперь позвоните диспетчеру: уточним ситуацию, маршрут и стоимость выезда.'
							: 'Менеджер свяжется с вами, уточнит задачу и согласует дальнейшие действия.';

				call.hidden = true;

				if (
					result.direction === 'help' &&
					/^\+?[\d\s()-]{10,}$/.test(config.phone)
				) {
					call.href = `tel:${config.phone.replace(/[^+\d]/g, '')}`;
					call.hidden = false;
				}

				dialog.showModal();
				form.reset();
				files.set(form, []);
				renderPhotos(form);
				keys.delete(form);

				if (form === personal) {
					setService('repair');
				}
			} catch (requestError) {
				error.textContent = requestError.message;
				error.hidden = false;

				for (const field of requestError.fields || []) {
					const input = form.elements[field.field];

					if (input) {
						input.setAttribute('aria-invalid', 'true');
					}
				}

				if (requestError.code === 'IDEMPOTENCY_CONFLICT') {
					keys.delete(form);
				}

				error.scrollIntoView({
					block: 'center',
					behavior: 'smooth',
				});
			} finally {
				button.disabled = false;
				button.replaceChildren(...label.childNodes);
			}
		});
	}
}