import { jsonSchema, tool } from 'ai';

type WeatherInput = { location: string };
type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export async function fetchWeather(
	location: string,
	fetcher: Fetch = fetch,
	abortSignal?: AbortSignal
) {
	const cleanLocation = typeof location === 'string' ? location.trim() : '';
	if (!cleanLocation || cleanLocation.length > 200) {
		return 'Error: Location must be 1-200 characters.';
	}

	const url = new URL(`https://wttr.in/${encodeURIComponent(cleanLocation)}`);
	url.searchParams.set('format', '3');
	const timeout = AbortSignal.timeout(10_000);

	try {
		const response = await fetcher(url, {
			signal: abortSignal ? AbortSignal.any([abortSignal, timeout]) : timeout
		});
		if (!response.ok) return `Error: Weather request failed with status ${response.status}.`;
		return (await response.text()).trim() || 'No weather data found.';
	} catch (error) {
		if (abortSignal?.aborted) throw error;
		return timeout.aborted ? 'Error: Weather request timed out.' : 'Error: Weather request failed.';
	}
}

export const getWeather = tool({
	description: 'Get the current weather for a city or location.',
	inputSchema: jsonSchema<WeatherInput>({
		type: 'object',
		properties: { location: { type: 'string', minLength: 1, maxLength: 200 } },
		required: ['location'],
		additionalProperties: false
	}),
	execute: ({ location }, { abortSignal }) => fetchWeather(location, fetch, abortSignal)
});
