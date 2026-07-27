import { jsonSchema, tool } from 'ai';

type SearchInput = { query: string };
type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

const decodeHtml = (value: string) =>
	value.replace(/&(#(?:x[\da-f]+|\d+)|amp|quot|apos|lt|gt|nbsp);/gi, (_, entity: string) => {
		if (entity[0] === '#') {
			const codePoint = Number.parseInt(
				entity.slice(entity[1]?.toLowerCase() === 'x' ? 2 : 1),
				entity[1]?.toLowerCase() === 'x' ? 16 : 10
			);
			return codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : '';
		}
		return (
			{ amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' }[entity.toLowerCase()] ?? ''
		);
	});

const text = (html: string) =>
	decodeHtml(html.replace(/<[^>]+>/g, ' '))
		.replace(/\s+/g, ' ')
		.trim();

function attribute(attributes: string, name: string) {
	const match = attributes.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i'));
	return decodeHtml(match?.[1] ?? match?.[2] ?? '');
}

function resultUrl(href: string) {
	const url = new URL(href, 'https://duckduckgo.com');
	const isDuckDuckGo =
		url.hostname === 'duckduckgo.com' || url.hostname.endsWith('.duckduckgo.com');
	if (!isDuckDuckGo) return url.href;
	return url.pathname === '/l/' ? url.searchParams.get('uddg') : null;
}

export function parseSearchResults(html: string, limit = 5) {
	const anchors = [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)];
	const results: { title: string; url: string; snippet: string }[] = [];

	for (let index = 0; index < anchors.length && results.length < limit; index++) {
		const classes = attribute(anchors[index][1], 'class').split(/\s+/);
		if (!classes.includes('result__a')) continue;

		let snippet = '';
		for (let next = index + 1; next < anchors.length; next++) {
			const nextClasses = attribute(anchors[next][1], 'class').split(/\s+/);
			if (nextClasses.includes('result__a')) break;
			if (nextClasses.includes('result__snippet')) {
				snippet = text(anchors[next][2]);
				break;
			}
		}

		try {
			const url = resultUrl(attribute(anchors[index][1], 'href'));
			if (!url) continue;
			results.push({ title: text(anchors[index][2]), url, snippet });
		} catch {
			// Skip malformed result links.
		}
	}

	return results;
}

export async function searchWeb(query: string, fetcher: Fetch = fetch, abortSignal?: AbortSignal) {
	const cleanQuery = typeof query === 'string' ? query.trim() : '';
	if (!cleanQuery || cleanQuery.length > 500)
		return 'Error: Search query must be 1-500 characters.';

	const url = new URL('https://html.duckduckgo.com/html/');
	url.searchParams.set('q', cleanQuery);
	const timeout = AbortSignal.timeout(15_000);

	try {
		const response = await fetcher(url, {
			headers: {
				accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
				'accept-language': 'en-US,en;q=0.9',
				'user-agent':
					'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
			},
			signal: abortSignal ? AbortSignal.any([abortSignal, timeout]) : timeout
		});
		if (!response.ok) return `Error: Search failed with status ${response.status}.`;

		const results = parseSearchResults(await response.text());
		if (!results.length) {
			return 'No search results found. DuckDuckGo may be blocking automated requests.';
		}

		return results
			.map(
				(result, index) =>
					`[${index + 1}] ${result.title}\nURL: ${result.url}${result.snippet ? `\n${result.snippet}` : ''}`
			)
			.join('\n\n');
	} catch (error) {
		if (abortSignal?.aborted) throw error;
		return timeout.aborted ? 'Error: Search timed out.' : 'Error: Search failed.';
	}
}

export const webSearch = tool({
	description:
		'Search the web with DuckDuckGo for current information. Returns titles, URLs, and snippets.',
	inputSchema: jsonSchema<SearchInput>({
		type: 'object',
		properties: { query: { type: 'string', minLength: 1, maxLength: 500 } },
		required: ['query'],
		additionalProperties: false
	}),
	execute: ({ query }, { abortSignal }) => searchWeb(query, fetch, abortSignal)
});
