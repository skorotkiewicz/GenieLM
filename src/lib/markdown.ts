import { katex } from '@mdit/plugin-katex';
import hljs from 'highlight.js/lib/common';
import MarkdownIt from 'markdown-it';

const markdown = new MarkdownIt({
	html: false,
	breaks: true,
	linkify: true
});

markdown.options.highlight = (code, language) => {
	const highlighted =
		language && hljs.getLanguage(language)
			? hljs.highlight(code, { language, ignoreIllegals: true }).value
			: markdown.utils.escapeHtml(code);
	return `<pre class="hljs"><button type="button" class="copy-code" aria-label="Copy code">Copy</button><code>${highlighted}</code></pre>`;
};

markdown.use(katex, { delimiters: 'all', mathFence: true });

export function renderMarkdown(content: string) {
	const normalized = content.replace(/^(`{3,}|~{3,})(?:latex|tex)\s*$/gim, '$1math');
	return markdown.render(normalized);
}
