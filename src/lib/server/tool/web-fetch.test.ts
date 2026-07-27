import { expect, test } from 'bun:test';
import { fetchWebPage } from './web-fetch';

const publicDns = async () => [{ address: '93.184.216.34', family: 4 }];

test('returns readable website text without executable content', async () => {
	let requested: URL | undefined;
	const fetcher = async (input: string | URL | Request) => {
		requested = new URL(String(input));
		return new Response(
			'<html><head><title>Example</title><style>hidden</style></head><body><h1>Hello &amp; welcome</h1><script>alert(1)</script><p>Useful text.</p></body></html>',
			{ headers: { 'content-type': 'text/html' } }
		);
	};

	await expect(fetchWebPage(' https://example.com/docs ', fetcher, publicDns)).resolves.toBe(
		'Source: https://example.com/docs\n\nExample\nHello & welcome\nUseful text.'
	);
	expect(requested?.href).toBe('https://example.com/docs');
});

test('rejects private network URLs before fetching', async () => {
	let fetched = false;
	const result = await fetchWebPage('http://127.0.0.1/admin', async () => {
		fetched = true;
		return new Response('secret');
	});

	expect(result).toContain('public HTTP(S) URL');
	expect(fetched).toBe(false);
});

test('rejects redirects to private network URLs', async () => {
	let requests = 0;
	const result = await fetchWebPage(
		'https://example.com',
		async () => {
			requests++;
			return new Response(null, { status: 302, headers: { location: 'http://localhost/admin' } });
		},
		publicDns
	);

	expect(result).toContain('public HTTP(S) URL');
	expect(requests).toBe(1);
});

test('rejects oversized website responses', async () => {
	const result = await fetchWebPage(
		'https://example.com',
		async () =>
			new Response('ignored', { headers: { 'content-length': String(5 * 1024 * 1024 + 1) } }),
		publicDns
	);

	expect(result).toContain('5 MB limit');
});
