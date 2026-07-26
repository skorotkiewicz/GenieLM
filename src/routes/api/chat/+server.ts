import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { convertToModelMessages, streamText, type UIMessage } from 'ai';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

const provider = createOpenAICompatible({
	name: 'local',
	baseURL: 'http://192.168.0.124:8888/v1'
});

export const POST: RequestHandler = async ({ request }) => {
	let messages: UIMessage[];

	try {
		({ messages } = await request.json());
	} catch {
		return json({ error: 'Invalid request body.' }, { status: 400 });
	}

	if (
		!Array.isArray(messages) ||
		messages.length === 0 ||
		messages.some(
			(message) =>
				!message ||
				!['user', 'assistant'].includes(message.role) ||
				!Array.isArray(message.parts) ||
				message.parts.some((part) => part.type !== 'text' || typeof part.text !== 'string')
		)
	) {
		return json({ error: 'Messages must be a non-empty chat history.' }, { status: 400 });
	}

	try {
		const result = streamText({
			model: provider('GenieLM'),
			system: 'You are GenieLM, a helpful and concise assistant.',
			messages: await convertToModelMessages(messages),
			stopSequences: ['<|im_end|>', '<|eot_id|>', '<|end|>', '</s>']
		});

		return result.toTextStreamResponse();
	} catch {
		return json({ error: 'The local model is unavailable.' }, { status: 502 });
	}
};
