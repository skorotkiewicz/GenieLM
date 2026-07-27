import { expect, test } from 'bun:test';
import { fetchWeather } from './weather';

test('returns current weather for an encoded location', async () => {
	let requested: URL | undefined;
	const fetcher = async (input: string | URL | Request) => {
		requested = new URL(String(input));
		return new Response('New York: ☀️ +21°C\n');
	};

	await expect(fetchWeather(' New York ', fetcher)).resolves.toBe('New York: ☀️ +21°C');
	expect(requested?.href).toBe('https://wttr.in/New%20York?format=3');
});
