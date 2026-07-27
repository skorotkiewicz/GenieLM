import { searchKnowledge } from '$lib/server/knowledge';
import { jsonSchema, tool } from 'ai';

type SearchKnowledgeInput = { query: string };

export async function findKnowledge(query: string) {
	const cleanQuery = typeof query === 'string' ? query.trim() : '';
	if (!cleanQuery || cleanQuery.length > 500) return 'Error: Query must be 1-500 characters.';

	try {
		const results = await searchKnowledge(cleanQuery);
		if (!results.length) return 'No personal knowledge documents have been indexed.';

		return results
			.map(
				(result, index) =>
					`[${index + 1}] Source: ${result.name}\n${result.content}\nDistance: ${result.distance.toFixed(4)}`
			)
			.join('\n\n');
	} catch {
		return 'Error: The local knowledge store is unavailable.';
	}
}

export const searchPersonalKnowledge = tool({
	description:
		"Search the user's private local documents for relevant passages. Use this for questions about their manuals, notes, policies, or personal knowledge, and cite source filenames.",
	inputSchema: jsonSchema<SearchKnowledgeInput>({
		type: 'object',
		properties: { query: { type: 'string', minLength: 1, maxLength: 500 } },
		required: ['query'],
		additionalProperties: false
	}),
	execute: ({ query }) => findKnowledge(query)
});
