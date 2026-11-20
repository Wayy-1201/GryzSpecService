import { api } from './api.js';
import { initNavigation } from './navigation.js';
import { initTheme } from './theme.js';
import {
	fillContacts,
	initDialogs,
	toast,
	el,
	safeURL,
} from './ui.js';
import { initForms } from './forms.js';
import { initChat } from './chatbot.js';

initNavigation();
initTheme();
initDialogs();
initChat();

async function start() {
	try {
		const [config, services] = await Promise.all([
			api('config'),
			api('services'),
		]);

		fillContacts(config);
		initForms(config, services);
	} catch (error) {
		toast(error.message);

		const picker = document.querySelector('#service-picker');
		const note = el('p', 'form-error', 'Не удалось загрузить форму.');
		const retry = el('button', 'text-link', 'Повторить загрузку');

		retry.addEventListener('click', () => {
			picker.replaceChildren();
			start();
		});

		picker.append(note, retry);

		document.querySelectorAll('.submit-button').forEach(button => {
			button.disabled = true;
		});

		return;
	}

	document.querySelectorAll('.submit-button').forEach(button => {
		button.disabled = false;
	});
}

start();

api('reviews')
	.then(data => {
		if (!safeURL(data.widget_url)) {
			return;
		}

		const box = document.querySelector('#reviews-content');
		const iframe = el('iframe');

		iframe.src = data.widget_url;
		iframe.title = 'Отзывы о ГрузСпецСервис на Яндекс Картах';
		iframe.loading = 'lazy';
		iframe.referrerPolicy = 'strict-origin-when-cross-origin';

		box.replaceChildren(iframe);
	})
	.catch(() => {});

const gallery = document.querySelector('.work-gallery-window');
const track = gallery.querySelector('.work-gallery-track');

let galleryDrag = null;

gallery.addEventListener('pointerdown', event => {
	const isNonPrimaryMouseButton =
		event.pointerType === 'mouse' && event.button !== 0;
	const prefersReducedMotion = matchMedia(
		'(prefers-reduced-motion: reduce)'
	).matches;

	if (isNonPrimaryMouseButton || prefersReducedMotion) {
		return;
	}

	const offset = new DOMMatrixReadOnly(
		getComputedStyle(track).transform
	).m41;

	track.style.animation = 'none';
	track.style.transform = `translateX(${offset}px)`;

	galleryDrag = {
		id: event.pointerId,
		x: event.clientX,
		offset,
	};

	gallery.setPointerCapture(event.pointerId);
});

gallery.addEventListener('pointermove', event => {
	if (!galleryDrag || event.pointerId !== galleryDrag.id) {
		return;
	}

	const step =
		(track.scrollWidth + parseFloat(getComputedStyle(track).gap)) / 2;
	const offset =
		((galleryDrag.offset + event.clientX - galleryDrag.x) % step + step) %
			step -
		step;

	track.style.transform = `translateX(${offset}px)`;
});

function resumeGallery(event) {
	if (!galleryDrag || event.pointerId !== galleryDrag.id) {
		return;
	}

	const step =
		(track.scrollWidth + parseFloat(getComputedStyle(track).gap)) / 2;
	const offset = new DOMMatrixReadOnly(
		getComputedStyle(track).transform
	).m41;

	track.style.transform = '';
	track.style.animation = '';
	track.style.animationDelay = `${(offset / step) * 40}s`;

	galleryDrag = null;
}

gallery.addEventListener('pointerup', resumeGallery);
gallery.addEventListener('pointercancel', resumeGallery);
