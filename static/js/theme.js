export function initTheme() {
	const buttons = document.querySelectorAll('[data-theme-choice]');
	const toggle = document.querySelector('[data-theme-toggle]');
	const textToggle = document.querySelector('[data-text-size-toggle]');
	const sizes = ['normal', 'large', 'larger'];

	const stored = () => {
		try {
			const theme = localStorage.getItem('gss-theme');
			return ['light', 'dark', 'night'].includes(theme) ? theme : 'light';
		} catch {
			return 'light';
		}
	};

	// Возвращает дату в Москве, к которой относится текущий ночной режим.
	const nightKey = () => {
		const parts = Object.fromEntries(
			new Intl.DateTimeFormat('en-CA', {
				timeZone: 'Europe/Moscow',
				year: 'numeric',
				month: '2-digit',
				day: '2-digit',
				hour: '2-digit',
				hour12: false,
			})
				.formatToParts(new Date())
				.map(part => [part.type, part.value])
		);

		const hour = Number(parts.hour);

		if (hour >= 6 && hour < 22) {
			return null;
		}

		const day = new Date(
			Date.UTC(
				Number(parts.year),
				Number(parts.month) - 1,
				Number(parts.day) - (hour < 6 ? 1 : 0)
			)
		);

		return day.toISOString().slice(0, 10);
	};

	function apply() {
		let manualNight = '';

		try {
			manualNight = localStorage.getItem('gss-theme-manual-night') || '';
		} catch {
			// Настройки темы останутся доступными только до перезагрузки страницы.
		}

		const key = nightKey();
		const theme = key && manualNight !== key ? 'night' : stored();

		document.documentElement.dataset.theme = theme;

		buttons.forEach(button => {
			button.setAttribute(
				'aria-pressed',
				String(button.dataset.themeChoice === theme)
			);
		});

		document.querySelector('meta[name="theme-color"]').content =
			theme === 'light'
				? '#f5f5f2'
				: theme === 'dark'
					? '#242624'
					: '#0c100d';

		const toggleLabel =
			theme === 'light'
				? 'Включить тёмную тему'
				: 'Включить светлую тему';

		toggle.setAttribute('aria-label', toggleLabel);
		toggle.title = toggleLabel;
		toggle.querySelector('use').setAttribute(
			'href',
			theme === 'light' ? '#i-moon' : '#i-sun'
		);
	}

	function select(theme) {
		try {
			localStorage.setItem('gss-theme', theme);
			localStorage.setItem(
				'gss-theme-manual-night',
				nightKey() || ''
			);
		} catch {
			// Тема применится на этой странице, даже если её не удалось сохранить.
		}

		apply();
	}

	buttons.forEach(button => {
		button.addEventListener('click', () => {
			select(button.dataset.themeChoice);
		});
	});

	toggle.addEventListener('click', () => {
		const nextTheme =
			document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';

		select(nextTheme);
	});

	function applyTextSize() {
		let size = 'normal';

		try {
			size = localStorage.getItem('gss-text-size') || 'normal';
		} catch {
			// Используем обычный размер, если настройки недоступны.
		}

		if (!sizes.includes(size)) {
			size = 'normal';
		}

		document.documentElement.dataset.textSize = size;

		const nextSize = sizes[(sizes.indexOf(size) + 1) % sizes.length];
		const label =
			nextSize === 'normal'
				? 'Вернуть обычный размер текста'
				: 'Увеличить текст';

		textToggle.setAttribute('aria-label', label);
		textToggle.title = label;
		textToggle.setAttribute(
			'aria-valuetext',
			size === 'normal'
				? 'Обычный'
				: size === 'large'
					? 'Крупный'
					: 'Очень крупный'
		);
		textToggle.querySelector('span').textContent =
			size === 'normal' ? 'A+' : size === 'large' ? 'A++' : 'A';
	}

	textToggle.addEventListener('click', () => {
		const currentSize = document.documentElement.dataset.textSize;
		const nextSize = sizes[(sizes.indexOf(currentSize) + 1) % sizes.length];

		try {
			localStorage.setItem('gss-text-size', nextSize);
		} catch {
			// Размер текста всё равно применится до перезагрузки страницы.
		}

		applyTextSize();
	});

	apply();
	applyTextSize();

	window.setInterval(apply, 30_000);
}