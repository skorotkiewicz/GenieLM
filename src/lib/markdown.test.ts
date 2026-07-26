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

test('renders inline and display KaTeX', () => {
	const inline = renderMarkdown('Energy is $E = mc^2$.');
	const display = renderMarkdown('$$\nE = mc^2\n$$');

	expect(inline).toContain('class="katex"');
	expect(display).toContain("class='katex-block'");
});

test('renders old latex fences as KaTeX instead of code', () => {
	const html = renderMarkdown('```latex\nE = mc^2\n```');

	expect(html).toContain("class='katex-block'");
	expect(html).not.toContain('copy-code');
});
