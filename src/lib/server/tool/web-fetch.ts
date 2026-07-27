import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { jsonSchema, tool } from 'ai';
import { decodeHtml } from './web-search';

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_OUTPUT = 8_000;
const MAX_REDIRECTS = 5;
const PUBLIC_URL_ERROR = 'Error: URL must be a public HTTP(S) URL.';

type FetchInput = { url: string };
type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
type Resolve = (hostname: string) => Promise<{ address: string; family: number }[]>;

const resolveDns: Resolve = (hostname) => lookup(hostname, { all: true, verbatim: true });
const blockedIpv4 = new BlockList();
const blockedIpv6 = new BlockList();

for (const [network, prefix] of [
	['0.0.0.0', 8],
	['10.0.0.0', 8],
	['100.64.0.0', 10],
	['127.0.0.0', 8],
	['169.254.0.0', 16],
	['172.16.0.0', 12],
	['192.0.0.0', 24],
	['192.168.0.0', 16],
	['198.18.0.0', 15],
	['224.0.0.0', 4],
	['240.0.0.0', 4]
] as const) {
	blockedIpv4.addSubnet(network, prefix, 'ipv4');
}

for (const [network, prefix] of [
	['::', 128],
	['::1', 128],
	['::ffff:0:0', 96],
	['64:ff9b::', 96],
	['100::', 64],
	['2001:db8::', 32],
	['fc00::', 7],
	['fe80::', 10],
	['ff00::', 8]
] as const) {
	blockedIpv6.addSubnet(network, prefix, 'ipv6');
}

function isPublicAddress(address: string) {
	const normalized = address.split('%')[0];
	const family = isIP(normalized);
	if (family === 4) return !blockedIpv4.check(normalized, 'ipv4');
	if (family === 6) return !blockedIpv6.check(normalized, 'ipv6');
	return false;
}

async function validateUrl(url: URL, resolve: Resolve) {
	if (
		!['http:', 'https:'].includes(url.protocol) ||
		url.username ||
		url.password ||
		url.href.length > 2_048
	) {
		throw new Error(PUBLIC_URL_ERROR);
	}

	const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
	if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) {
		throw new Error(PUBLIC_URL_ERROR);
	}

	if (isIP(hostname)) {
		if (!isPublicAddress(hostname)) throw new Error(PUBLIC_URL_ERROR);
		return;
	}

	let addresses: { address: string; family: number }[];
	try {
		addresses = await resolve(hostname);
	} catch {
		throw new Error(PUBLIC_URL_ERROR);
	}
	if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) {
		throw new Error(PUBLIC_URL_ERROR);
	}
}

async function readBody(response: Response) {
	const contentLength = Number(response.headers.get('content-length'));
	if (Number.isFinite(contentLength) && contentLength > MAX_BYTES) {
		throw new Error('Error: Response exceeds the 5 MB limit.');
	}
	if (!response.body) return '';

	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let bytes = 0;
	let content = '';

	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		bytes += value.byteLength;
		if (bytes > MAX_BYTES) {
			await reader.cancel();
			throw new Error('Error: Response exceeds the 5 MB limit.');
		}
		content += decoder.decode(value, { stream: true });
	}
	return content + decoder.decode();
}

export function htmlToText(html: string) {
	return decodeHtml(
		html
			.replace(/<!--[\s\S]*?-->/g, ' ')
			.replace(/<(script|style|noscript|iframe)\b[^>]*>[\s\S]*?(?:<\/\1>|$)/gi, ' ')
			.replace(
				/<\/?(?:address|article|aside|blockquote|br|div|footer|h[1-6]|header|li|main|nav|ol|p|pre|section|table|title|tr|ul)\b[^>]*>/gi,
				'\n'
			)
			.replace(/<[^>]+>/g, ' ')
	)
		.split(/\r?\n/)
		.map((line) => line.replace(/\s+/g, ' ').trim())
		.filter(Boolean)
		.join('\n');
}

export async function fetchWebPage(
	input: string,
	fetcher: Fetch = fetch,
	resolve: Resolve = resolveDns,
	abortSignal?: AbortSignal
) {
	let current: URL;
	try {
		current = new URL(typeof input === 'string' ? input.trim() : '');
	} catch {
		return PUBLIC_URL_ERROR;
	}

	const timeout = AbortSignal.timeout(20_000);
	const signal = abortSignal ? AbortSignal.any([abortSignal, timeout]) : timeout;

	try {
		for (let redirects = 0; ; redirects++) {
			await validateUrl(current, resolve);
			const response = await fetcher(current, {
				headers: {
					accept: 'text/html,text/markdown,text/plain,application/xhtml+xml,application/json;q=0.9',
					'accept-language': 'en-US,en;q=0.9',
					'user-agent':
						'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
				},
				redirect: 'manual',
				signal
			});

			if ([301, 302, 303, 307, 308].includes(response.status)) {
				const location = response.headers.get('location');
				if (!location) return 'Error: Website returned an invalid redirect.';
				if (redirects >= MAX_REDIRECTS) return 'Error: Website redirected too many times.';
				current = new URL(location, current);
				continue;
			}
			if (!response.ok) return `Error: Website returned status ${response.status}.`;

			const contentType = response.headers.get('content-type')?.split(';', 1)[0].trim() ?? '';
			if (
				contentType &&
				!contentType.startsWith('text/') &&
				!['application/json', 'application/xml', 'application/xhtml+xml'].includes(contentType)
			) {
				return `Error: Unsupported content type ${contentType}.`;
			}

			const content = await readBody(response);
			const readable =
				contentType === 'text/html' || contentType === 'application/xhtml+xml'
					? htmlToText(content)
					: content.trim();
			if (!readable) return 'Error: Website returned no readable text.';
			return `Source: ${current.href}\n\n${readable.slice(0, MAX_OUTPUT)}`;
		}
	} catch (error) {
		if (abortSignal?.aborted) throw error;
		if (timeout.aborted) return 'Error: Website fetch timed out.';
		return error instanceof Error && error.message.startsWith('Error:')
			? error.message
			: 'Error: Website fetch failed.';
	}
}

export const webFetch = tool({
	description:
		'Open a specific public HTTP(S) webpage and return readable text. Use this after webSearch when snippets are insufficient.',
	inputSchema: jsonSchema<FetchInput>({
		type: 'object',
		properties: { url: { type: 'string', minLength: 1, maxLength: 2_048 } },
		required: ['url'],
		additionalProperties: false
	}),
	execute: ({ url }, { abortSignal }) => fetchWebPage(url, fetch, resolveDns, abortSignal)
});
