import { expect, test } from 'bun:test';
import { renderMarkdown } from './markdown';

test('renders GFM-style content without executing raw HTML', () => {
	const html = renderMarkdown(
		'# Title\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n<script>alert(1)</script>'
	);

	expect(html).toContain('<h1>Title</h1>');
	expect(html).toContain('<table>');
	expect(html).not.toContain('<script>');
	expect(html).toContain('&lt;script&gt;');
});

test('syntax-highlights supported fenced-code languages', () => {
	const html = renderMarkdown('```javascript\nconst answer = 42;\n```');

	expect(html).toContain('<pre class="hljs">');
	expect(html).toContain('<button type="button" class="copy-code"');
	expect(html).toContain('<span class="hljs-keyword">const</span>');
});

test('copyable unknown-language blocks remain escaped', () => {
	const html = renderMarkdown('```unknown\n<script>alert(1)</script>\n```');

	expect(html).toContain('class="copy-code"');
	expect(html).not.toContain('<script>');
	expect(html).toContain('&lt;script&gt;');
});
