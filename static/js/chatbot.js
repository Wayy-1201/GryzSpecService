import { api } from './api.js';
import { el, toast } from './ui.js';

export function initChat() {
	const dialog = document.querySelector('#chat-dialog');
	const messages = document.querySelector('#chat-messages');
	const form = document.querySelector('#chat-form');
	const input = document.querySelector('#chat-input');
	const button = form.querySelector('button');

	let request = null;
	let generation = 0;

	function reset() {
		generation++;
		request?.abort();
		request = null;

		messages.replaceChildren();
		input.value = '';
		button.disabled = false;
		input.disabled = false;

		const welcome = el('div', 'chat-welcome');
		const image = el('img');
		const copy = el('div');

		image.src = '/static/images/cat.webp';
		image.alt = 'Кот-механик — консультант';
		image.width = 140;
		image.height = 176;

		copy.append(
			el('h3', '', 'Разберёмся, куда обратиться'),
			el(
				'p',
				'',
				'Подскажу, какую заявку выбрать, как вызвать помощь и где указать детали'
			)
		);

		welcome.append(image, copy);
		messages.append(welcome);

		const suggestions = el('div', 'chat-suggestions');
		const questions = [
			'Нужна помощь на дороге',
			'Как записаться на ремонт?',
			'Обслуживание автопарка',
		];

		questions.forEach(text => {
			const suggestion = el('button', '', text);

			suggestion.type = 'button';
			suggestion.addEventListener('click', () => {
				input.value = text;
				form.requestSubmit();
			});

			suggestions.append(suggestion);
		});

		messages.append(suggestions);
	}

	document.querySelectorAll('[data-chat]').forEach(button => {
		button.addEventListener('click', () => {
			reset();
			dialog.showModal();
		});
	});

	document
		.querySelector('[data-close-chat]')
		.addEventListener('click', () => dialog.close());

	dialog.addEventListener('close', reset);

	form.addEventListener('submit', async event => {
		event.preventDefault();

		const text = input.value.trim();

		if (!text || request) {
			return;
		}

		if (text.length > 2000) {
			toast('Вопрос должен быть короче 2000 символов.');
			return;
		}

		const currentGeneration = generation;

		messages.querySelector('.chat-suggestions')?.remove();
		messages.append(el('p', 'message user', text));

		input.value = '';
		button.disabled = true;

		const pending = el('p', 'message', 'Кот думает…');
		messages.append(pending);
		messages.scrollTop = messages.scrollHeight;

		request = new AbortController();

		try {
			const result = await api('chat', {
				method: 'POST',
				body: { message: text },
				signal: request.signal,
			});

			// Игнорируем ответ, если диалог сбросили или закрыли во время запроса.
			if (currentGeneration === generation) {
				pending.textContent = result.answer;
			}
		} catch (error) {
			if (currentGeneration === generation) {
				pending.classList.add('error');
				pending.textContent = error.message;
				input.value = text;
			}
		} finally {
			if (currentGeneration === generation) {
				request = null;
				button.disabled = false;
				messages.scrollTop = messages.scrollHeight;
				input.focus();
			}
		}
	});
}
