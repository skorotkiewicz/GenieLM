export type ChatStreamEvent = {
	type: 'reasoning-delta' | 'text-delta';
	text: string;
};

type ModelStreamPart = {
	type: string;
	text?: string;
};

export function createChatStreamResponse(source: AsyncIterable<ModelStreamPart>) {
	const encoder = new TextEncoder();
	const stream = new ReadableStream<Uint8Array>({
		async start(controller) {
			try {
				for await (const part of source) {
					if (part.type !== 'reasoning-delta' && part.type !== 'text-delta') continue;
					controller.enqueue(
						encoder.encode(`${JSON.stringify({ type: part.type, text: part.text })}\n`)
					);
				}
				controller.close();
			} catch (error) {
				controller.error(error);
			}
		}
	});

	return new Response(stream, {
		headers: {
			'cache-control': 'no-cache',
			'content-type': 'application/x-ndjson; charset=utf-8'
		}
	});
}

function parseChatStreamEvent(line: string): ChatStreamEvent {
	const event: unknown = JSON.parse(line);
	if (!event || typeof event !== 'object') throw new Error('Invalid chat stream event.');

	const { type, text } = event as Record<string, unknown>;
	if ((type !== 'reasoning-delta' && type !== 'text-delta') || typeof text !== 'string') {
		throw new Error('Invalid chat stream event.');
	}

	return { type, text };
}

export async function readChatStream(
	stream: ReadableStream<Uint8Array>,
	onEvent: (event: ChatStreamEvent) => void | Promise<void>
) {
	const reader = stream.getReader();
	const decoder = new TextDecoder();
	let buffer = '';

	while (true) {
		const { done, value } = await reader.read();
		buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });

		let newline;
		while ((newline = buffer.indexOf('\n')) !== -1) {
			const line = buffer.slice(0, newline).trim();
			buffer = buffer.slice(newline + 1);
			if (line) await onEvent(parseChatStreamEvent(line));
		}

		if (done) break;
	}

	if (buffer.trim()) await onEvent(parseChatStreamEvent(buffer));
}
