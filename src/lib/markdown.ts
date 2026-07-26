import MarkdownIt from 'markdown-it';

const markdown = new MarkdownIt({
	html: false,
	breaks: true,
	linkify: true
});

export function renderMarkdown(content: string) {
	return markdown.render(content);
}
