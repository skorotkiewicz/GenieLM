import { provider } from '$lib/server/provider';
import { generateText } from 'ai';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	let prompt: unknown;

	try {
		({ prompt } = await request.json());
	} catch {
		return json({ error: 'Invalid request body.' }, { status: 400 });
	}

	if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 10_000) {
		return json({ error: 'Prompt must be a non-empty string.' }, { status: 400 });
	}

	try {
		const { text } = await generateText({
			model: provider('GenieLM'),
			abortSignal: request.signal,
			system:
				'Create a concise 3-7 word sidebar title summarizing the user request. Return only the title, without quotes, punctuation, or Markdown.',
			prompt,
			temperature: 0,
			maxOutputTokens: 24,
			timeout: 30_000
		});
		const title = text
			.trim()
			.split('\n')[0]
			.replace(/^#+\s*/, '')
			.replace(/^["'`]|["'`.!?]+$/g, '')
			.trim()
			.slice(0, 60);

		if (!title) throw new Error('Empty title');
		return json({ title });
	} catch {
		return json({ error: 'The local model could not create a title.' }, { status: 502 });
	}
};
