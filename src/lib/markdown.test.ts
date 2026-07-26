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
