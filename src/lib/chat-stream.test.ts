import { expect, test } from 'bun:test';
import { createChatStreamResponse, readChatStream, type ChatStreamEvent } from './chat-stream';

test('streams reasoning and answer deltas separately', async () => {
	async function* modelStream() {
		yield { type: 'reasoning-start' };
		yield { type: 'reasoning-delta', text: 'Check ' };
		yield { type: 'reasoning-delta', text: 'the facts.' };
		yield { type: 'text-delta', text: 'The answer.' };
		yield { type: 'finish' };
	}

	const response = createChatStreamResponse(modelStream());
	const events: ChatStreamEvent[] = [];
	await readChatStream(response.body!, (event) => {
		events.push(event);
	});

	expect(events).toEqual([
		{ type: 'reasoning-delta', text: 'Check ' },
		{ type: 'reasoning-delta', text: 'the facts.' },
		{ type: 'text-delta', text: 'The answer.' }
	]);
});

test('reads events split across network chunks', async () => {
	const encoder = new TextEncoder();
	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			controller.enqueue(encoder.encode('{"type":"reason'));
			controller.enqueue(encoder.encode('ing-delta","text":"work"}\n{"type":"text-delta"'));
			controller.enqueue(encoder.encode(',"text":"done"}'));
			controller.close();
		}
	});
	const events: ChatStreamEvent[] = [];

	await readChatStream(stream, (event) => {
		events.push(event);
	});

	expect(events).toEqual([
		{ type: 'reasoning-delta', text: 'work' },
		{ type: 'text-delta', text: 'done' }
	]);
});
