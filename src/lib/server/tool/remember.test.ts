import { expect, test } from 'bun:test';
import { memoryDocumentName, saveMemory } from './remember';

test('keeps memories in a safe reserved namespace', async () => {
	expect(memoryDocumentName(' Favorite / color: ')).toBe('[Memory] Favorite color.md');
	expect(await saveMemory('', 'blue')).toContain('title must be');
	expect(await saveMemory('Favorite color', '')).toContain('content must be');
});
