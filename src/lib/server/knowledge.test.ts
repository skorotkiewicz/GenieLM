import { expect, test } from 'bun:test';
import { chunkText } from './knowledge';

test('chunks documents with overlap without losing their ends', () => {
	const text = Array.from({ length: 300 }, (_, index) => `word-${index}`).join(' ');
	const chunks = chunkText(text);

	expect(chunks.length).toBeGreaterThan(1);
	expect(chunks.every((chunk) => chunk.length <= 1_200)).toBe(true);
	expect(chunks[0]).toContain(chunks[1].slice(0, 100));
	expect(chunks.at(-1)).toEndWith('word-299');
});
