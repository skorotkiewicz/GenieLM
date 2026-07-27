import { expect, test } from 'bun:test';
import { searchWeb } from './web-search';

const resultsPage = `
<div class="result result--ad">
	<a class="result__a" href="//duckduckgo.com/y.js?ad_domain=example.com">Sponsored result</a>
	<a class="result__snippet">Advertisement</a>
</div>
<div class="result results_links">
	<h2 class="result__title">
		<a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fkit.svelte.dev%2Fdocs&amp;rut=abc">SvelteKit &amp; docs</a>
	</h2>
	<a class="result__snippet" href="https://kit.svelte.dev/docs">Build <b>fast</b> web apps.</a>
</div>`;

test('returns decoded DuckDuckGo results', async () => {
	let requested: URL | undefined;
	const fetcher = async (input: string | URL | Request) => {
		requested = new URL(String(input));
		return new Response(resultsPage);
	};

	await expect(searchWeb('SvelteKit docs', fetcher)).resolves.toBe(
		'[1] SvelteKit & docs\nURL: https://kit.svelte.dev/docs\nBuild fast web apps.'
	);
	expect(requested?.hostname).toBe('html.duckduckgo.com');
	expect(requested?.searchParams.get('q')).toBe('SvelteKit docs');
});

test('reports blocked searches', async () => {
	const fetcher = async () => new Response('<form class="anomaly-modal"></form>');
	expect(await searchWeb('test', fetcher)).toContain('blocking automated requests');
});
