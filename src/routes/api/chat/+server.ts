import { createChatStreamResponse } from '$lib/chat-stream';
import { modelForRequest } from '$lib/server/provider';
import { convertToModelMessages, streamText, type UIMessage } from 'ai';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	let messages: UIMessage[];
	let provider: unknown;

	try {
		({ messages, provider } = await request.json());
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

	let model;
	try {
		model = modelForRequest(request, provider);
	} catch {
		return json({ error: 'Invalid or unsigned provider configuration.' }, { status: 400 });
	}

	try {
		const result = streamText({
			model,
			abortSignal: request.signal,
			system: 'You are GenieLM, a helpful and concise assistant.',
			messages: await convertToModelMessages(messages),
			stopSequences: ['<|im_end|>', '<|eot_id|>', '<|end|>', '</s>']
		});

		return createChatStreamResponse(result.stream);
	} catch {
		return json({ error: 'The selected provider is unavailable.' }, { status: 502 });
	}
};
