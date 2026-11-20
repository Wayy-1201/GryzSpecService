import { api } from './api.js';

export function icon(name) {
	const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
	const use = document.createElementNS(svg.namespaceURI, 'use');

	use.setAttribute('href', `#i-${name}`);
	svg.setAttribute('aria-hidden', 'true');
	svg.append(use);

	return svg;
}

export function el(tag, className, text) {
	const node = document.createElement(tag);

	if (className) {
		node.className = className;
	}

	if (text !== undefined) {
		node.textContent = text;
	}

	return node;
}

let toastTimer;

export function toast(message) {
	const node = document.querySelector('.toast');

	node.textContent = message;
	node.hidden = false;

	clearTimeout(toastTimer);
	toastTimer = setTimeout(() => {
		node.hidden = true;
	}, 6000);
}

export const money = value => {
	if (value === null) {
		return 'По запросу';
	}

	return `${new Intl.NumberFormat('ru-RU').format(value)} ₽`;
};

export function safeURL(value) {
	try {
		const url = new URL(value);
		return url.protocol === 'https:' ? url.href : null;
	} catch {
		return null;
	}
}

export function initDialogs() {
	const cookieInfo = el('section', 'settings-section settings-privacy');
	const copy = el('div');

	copy.append(
		el('h2', '', 'Cookies и локальные настройки'),
		el(
			'p',
			'muted',
			'В браузере хранится только выбранная тема. Рекламных и аналитических cookies нет. При загрузке карт и отзывов действуют правила Яндекса'
		)
	);

	cookieInfo.append(copy);
	document.querySelector('.settings-grid').append(cookieInfo);

	document.querySelectorAll('[data-close-dialog]').forEach(button => {
		button.addEventListener('click', () => {
			button.closest('dialog').close();
		});
	});

	document.querySelectorAll('.content-dialog').forEach(dialog => {
		dialog.addEventListener('click', event => {
			if (event.target !== dialog) {
				return;
			}

			const rect = dialog.getBoundingClientRect();
			const clickedOutside =
				event.clientX < rect.left ||
				event.clientX > rect.right ||
				event.clientY < rect.top ||
				event.clientY > rect.bottom;

			if (clickedOutside) {
				dialog.close();
			}
		});
	});

	document.querySelectorAll('[data-privacy]').forEach(button => {
		button.addEventListener('click', async () => {
			const dialog = document.querySelector('#privacy-dialog');
			const text = document.querySelector('#privacy-text');

			text.textContent = 'Загружаем документ…';
			dialog.showModal();

			try {
				text.textContent = (await api('privacy')).text;
			} catch (error) {
				text.textContent = error.message;
			}
		});
	});

	let scrollY = 0;

	// Фиксируем фон, пока открыто хотя бы одно диалоговое окно.
	const syncPageScroll = () => {
		const hasOpenDialog = Boolean(document.querySelector('dialog[open]'));
		const pageIsLocked = document.body.classList.contains('dialog-open');

		if (hasOpenDialog && !pageIsLocked) {
			scrollY = window.scrollY;
			document.body.style.top = `-${scrollY}px`;
			document.body.classList.add('dialog-open');
		} else if (!hasOpenDialog && pageIsLocked) {
			document.body.classList.remove('dialog-open');
			document.body.style.top = '';
			window.scrollTo(0, scrollY);
		}
	};

	document.querySelectorAll('dialog').forEach(dialog => {
		new MutationObserver(syncPageScroll).observe(dialog, {
			attributes: true,
			attributeFilter: ['open'],
		});
	});
}

export function fillContacts(config) {
	document.querySelector('#year').textContent = new Date().getFullYear();

	const phone = config.phone || '';
	const number = phone.replace(/[^\d+]/g, '');
	const validPhone = /^\+?\d{10,15}$/.test(number);

	document.querySelectorAll('[data-phone]').forEach(link => {
		link.textContent = phone || '+7 (___) ___-__-__';

		if (validPhone) {
			link.href = `tel:${number}`;
		}
	});

	const call = document.querySelector('[data-call]');

	if (validPhone) {
		call.href = `tel:${number}`;
		call.hidden = false;
	}

	document.querySelectorAll('[data-contact="address"]').forEach(element => {
		element.textContent = config.address || 'Адрес сервиса уточняется';
	});

	document.querySelectorAll('[data-email]').forEach(link => {
		if (!config.email) {
			return;
		}

		link.textContent = config.email;
		link.href = `mailto:${config.email}`;
		link.hidden = false;
	});

	const years = Number(config.years);
	const yearsBox = document.querySelector('[data-years]');

	if (yearsBox && years > 0) {
		const lastDigit = years % 10;
		const lastTwoDigits = years % 100;

		let label = 'лет';

		if (lastDigit === 1 && lastTwoDigits !== 11) {
			label = 'год';
		} else if (
			lastDigit >= 2 &&
			lastDigit <= 4 &&
			(lastTwoDigits < 10 || lastTwoDigits >= 20)
		) {
			label = 'года';
		}

		yearsBox.textContent = `${years} ${label} работы`;
		yearsBox.hidden = false;
	}

	for (const channel of ['telegram', 'max']) {
		const block = document.querySelector(`[data-messenger="${channel}"]`);
		const url = safeURL(config[`${channel}_url`]);

		if (!url) {
			continue;
		}

		const image = block.querySelector('img');
		const link = block.querySelector('a');
		const footerLink = document.querySelector(
			`[data-footer-messenger="${channel}"]`
		);

		image.src = `/api/qr/${channel}`;
		image.hidden = false;

		link.href = url;
		link.hidden = false;

		block.querySelector('small').hidden = true;

		if (footerLink) {
			footerLink.href = url;
			footerLink.target = '_blank';
			footerLink.rel = 'noopener';
			footerLink.title = `Открыть ${channel === 'max' ? 'MAX' : 'Telegram'}`;
			footerLink.removeAttribute('aria-disabled');
		}
	}
}
