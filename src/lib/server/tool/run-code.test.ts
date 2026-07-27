import { expect, test } from 'bun:test';
import { executeCode, podmanArgs } from './run-code';

test('builds a locked-down Podman command with a fixed interpreter', () => {
	const args = podmanArgs('python', '/tmp/job');

	expect(args).toContain('--network=none');
	expect(args).toContain('--read-only');
	expect(args).toContain('--cap-drop=all');
	expect(args).toContain('--security-opt=no-new-privileges');
	expect(args).toContain('--memory=256m');
	expect(args).toContain('--timeout=5');
	expect(args).toContain('--volume=/tmp/job:/workspace:ro,Z');
	expect(args.slice(-4)).toEqual([
		'localhost/genielm-sandbox:1',
		'python3',
		'-I',
		'/workspace/main.py'
	]);
});

test('rejects invalid code before starting a container', async () => {
	await expect(executeCode('ruby', 'puts 1')).resolves.toContain('Language must be');
	await expect(executeCode('python', '')).resolves.toContain('Code must be');
});
