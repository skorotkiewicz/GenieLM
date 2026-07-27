import {
	addKnowledgeDocument,
	deleteKnowledgeDocument,
	listKnowledgeDocuments
} from '$lib/server/knowledge';
import { jsonSchema, tool } from 'ai';

type RememberInput = { title: string; content: string };
type ForgetMemoryInput = { title: string };

export function memoryDocumentName(title: string) {
	const cleanTitle = title
		.trim()
		.replace(/[\p{Cc}<>:"/\\|?*]+/gu, ' ')
		.replace(/\s+/g, ' ')
		.slice(0, 80)
		.trim();
	return cleanTitle ? `[Memory] ${cleanTitle}.md` : '';
}

export async function saveMemory(title: unknown, content: unknown) {
	const cleanTitle = typeof title === 'string' ? title.trim() : '';
	const name = memoryDocumentName(cleanTitle);
	const cleanContent = typeof content === 'string' ? content.trim() : '';
	if (!name || cleanTitle.length > 100) {
		return 'Error: Memory title must be 1-100 characters.';
	}
	if (!cleanContent || cleanContent.length > 5_000) {
		return 'Error: Memory content must be 1-5,000 characters.';
	}

	try {
		await addKnowledgeDocument(name, `# ${name.slice(9, -3)}\n\n${cleanContent}`);
		return `Remembered as ${name}. The user can review or delete it in Account → Knowledge.`;
	} catch {
		return 'Error: Could not save the memory to local knowledge.';
	}
}

export function forgetSavedMemory(title: unknown) {
	const cleanTitle = typeof title === 'string' ? title.trim() : '';
	const name = memoryDocumentName(cleanTitle);
	if (!name || cleanTitle.length > 100) {
		return 'Error: Memory title must be 1-100 characters.';
	}

	try {
		const document = listKnowledgeDocuments().find((item) => item.name === name);
		if (!document) return `No memory found with title "${cleanTitle}".`;
		return deleteKnowledgeDocument(document.id)
			? `Forgot ${name}.`
			: 'Error: Could not delete the memory.';
	} catch {
		return 'Error: Could not access local memory.';
	}
}

export const remember = tool({
	description:
		"Save information to the user's private local memory. Call only when the current user explicitly asks you to remember or save something. Reusing a title updates that memory.",
	inputSchema: jsonSchema<RememberInput>({
		type: 'object',
		properties: {
			title: { type: 'string', minLength: 1, maxLength: 100 },
			content: { type: 'string', minLength: 1, maxLength: 5_000 }
		},
		required: ['title', 'content'],
		additionalProperties: false
	}),
	execute: ({ title, content }) => saveMemory(title, content)
});

export const forgetMemory = tool({
	description:
		'Delete one saved memory by its exact title. Call only when the current user explicitly asks you to forget or remove that memory. This cannot delete uploaded documents.',
	inputSchema: jsonSchema<ForgetMemoryInput>({
		type: 'object',
		properties: { title: { type: 'string', minLength: 1, maxLength: 100 } },
		required: ['title'],
		additionalProperties: false
	}),
	execute: ({ title }) => forgetSavedMemory(title)
});
