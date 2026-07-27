import { execFile } from 'node:child_process';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { jsonSchema, tool } from 'ai';

const IMAGE = 'localhost/genielm-sandbox:1';
const MAX_CODE_LENGTH = 20_000;
const MAX_OUTPUT_LENGTH = 64 * 1_024;

const programs = {
	python: { file: 'main.py', command: ['python3', '-I', '/workspace/main.py'] },
	javascript: { file: 'main.js', command: ['node', '/workspace/main.js'] },
	shell: { file: 'main.sh', command: ['/bin/sh', '/workspace/main.sh'] }
} as const;

type Language = keyof typeof programs;
type RunCodeInput = { language: Language; code: string };

export function podmanArgs(language: Language, workspace: string) {
	return [
		'run',
		'--rm',
		`--name=${basename(workspace)}`,
		'--pull=never',
		'--network=none',
		'--read-only',
		'--cap-drop=all',
		'--security-opt=no-new-privileges',
		'--pids-limit=64',
		'--memory=256m',
		'--memory-swap=256m',
		'--cpus=0.5',
		'--user=65534:65534',
		'--tmpfs=/tmp:rw,nosuid,nodev,noexec,size=16m',
		'--ulimit=nofile=64:64',
		'--ulimit=fsize=1048576:1048576',
		'--timeout=5',
		`--volume=${workspace}:/workspace:ro,Z`,
		'--workdir=/workspace',
		IMAGE,
		...programs[language].command
	];
}

function removeContainer(name: string) {
	return new Promise<void>((resolve) => {
		execFile('podman', ['rm', '--force', name], { timeout: 5_000 }, () => resolve());
	});
}

function runPodman(args: string[], abortSignal?: AbortSignal) {
	return new Promise<string>((resolve, reject) => {
		const startedAt = Date.now();
		execFile(
			'podman',
			args,
			{ encoding: 'utf8', maxBuffer: MAX_OUTPUT_LENGTH, timeout: 10_000, signal: abortSignal },
			(error, stdout, stderr) => {
				if (abortSignal?.aborted) return reject(error);
				if (error?.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
					return resolve('Error: Sandbox output exceeded 64 KB.');
				}
				if (error?.killed || (error?.code === 255 && Date.now() - startedAt >= 4_500)) {
					return resolve('Error: Sandbox timed out.');
				}
				if (error?.code === 'ENOENT') {
					return resolve('Error: Podman is not installed on the GenieLM server.');
				}

				const exitCode = typeof error?.code === 'number' ? error.code : error ? 1 : 0;
				if (exitCode === 125) {
					return resolve('Error: Sandbox failed to start. Run `bun run sandbox:build`.');
				}

				const output = [`Exit code: ${exitCode}`];
				if (stdout.trim()) output.push(`stdout:\n${stdout.trimEnd()}`);
				if (stderr.trim()) output.push(`stderr:\n${stderr.trimEnd()}`);
				resolve(output.join('\n'));
			}
		);
	});
}

export async function executeCode(language: unknown, code: unknown, abortSignal?: AbortSignal) {
	if (typeof language !== 'string' || !(language in programs)) {
		return 'Error: Language must be python, javascript, or shell.';
	}
	if (typeof code !== 'string' || !code.trim() || code.length > MAX_CODE_LENGTH) {
		return 'Error: Code must be 1-20,000 characters.';
	}

	const selected = programs[language as Language];
	const workspace = await mkdtemp(join(tmpdir(), 'genielm-sandbox-'));

	try {
		await chmod(workspace, 0o755);
		await writeFile(join(workspace, selected.file), code, { mode: 0o644 });
		// ponytail: per-container limits only; add a global queue before untrusted multi-user use.
		return await runPodman(podmanArgs(language as Language, workspace), abortSignal);
	} finally {
		await removeContainer(basename(workspace));
		await rm(workspace, { recursive: true, force: true });
	}
}

export const runCode = tool({
	description:
		'Execute Python, JavaScript, or POSIX shell code in an isolated Linux container. The container has no network or package installation.',
	inputSchema: jsonSchema<RunCodeInput>({
		type: 'object',
		properties: {
			language: { type: 'string', enum: ['python', 'javascript', 'shell'] },
			code: { type: 'string', minLength: 1, maxLength: MAX_CODE_LENGTH }
		},
		required: ['language', 'code'],
		additionalProperties: false
	}),
	execute: ({ language, code }, { abortSignal }) => executeCode(language, code, abortSignal)
});
