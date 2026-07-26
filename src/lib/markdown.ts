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

export function renderMarkdown(content: string) {
	return markdown.render(content);
}
