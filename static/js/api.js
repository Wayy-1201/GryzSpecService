export class APIError extends Error {
	constructor(message, code, fields = []) {
		super(message);

		this.code = code;
		this.fields = fields;
	}
}

export async function api(
	path,
	{ method = 'GET', body, headers = {}, signal } = {}
) {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), 60_000);

	if (signal) {
		signal.addEventListener(
			'abort',
			() => controller.abort(),
			{ once: true }
		);
	}

	try {
		const response = await fetch(`/api/${path}`, {
			method,
			body:
				body instanceof FormData
					? body
					: body === undefined
						? undefined
						: JSON.stringify(body),
			headers: {
				...(body !== undefined && !(body instanceof FormData)
					? { 'Content-Type': 'application/json' }
					: {}),
				...headers,
			},
			signal: controller.signal,
		});

		let result;

		try {
			result = await response.json();
		} catch {
			throw new APIError(
				'Сервер временно недоступен. Повторите попытку.',
				'SERVER_ERROR'
			);
		}

		if (!response.ok || !result.success) {
			throw new APIError(
				result.error?.message || 'Не удалось выполнить запрос.',
				result.error?.code,
				result.error?.fields
			);
		}

		return result.data;
	} catch (error) {
		if (error instanceof APIError) {
			throw error;
		}

		if (error.name === 'AbortError') {
			throw new APIError(
				'Ответ задерживается. Повторите отправку: повторная заявка не создастся.',
				'TIMEOUT'
			);
		}

		throw new APIError(
			'Нет связи с сервером. Проверьте интернет и попробуйте снова.',
			'NETWORK'
		);
	} finally {
		clearTimeout(timeout);
	}
}