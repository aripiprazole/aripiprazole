import { beforeEach, describe, expect, mock, spyOn, test } from 'bun:test';

import { createShellState, httpClient } from './commands';
import { executeShell, type PipelineExit } from './execute';
import {
	createEofFileDescriptor,
	createTerminalFileDescriptor
} from './filesystem';
import { asAbsolutePath, asExitCode } from './schemas';
import type { FileChunk, ProcessIO } from './types';

const decoder = new TextDecoder();
let shellState = createShellState();

type PendingExecution = Readonly<{
	execution: ReturnType<typeof executeShell>;
	stdout: FileChunk[];
	stderr: FileChunk[];
}>;

type CapturedExecution = Readonly<{
	result: PipelineExit;
	stdout: readonly FileChunk[];
	stderr: readonly FileChunk[];
}>;

const textOf = (chunks: readonly FileChunk[]): string =>
	chunks.map((chunk) => decoder.decode(chunk.bytes)).join('');

const start = (source: string): PendingExecution => {
	const stdout: FileChunk[] = [];
	const stderr: FileChunk[] = [];
	const io: ProcessIO = {
		stdin: createEofFileDescriptor(),
		stdout: createTerminalFileDescriptor('stdout', (_stream, value) => {
			stdout.push(value);
		}),
		stderr: createTerminalFileDescriptor('stderr', (_stream, value) => {
			stderr.push(value);
		})
	};

	return {
		execution: executeShell(source, io, shellState),
		stdout,
		stderr
	};
};

const execute = async (source: string): Promise<CapturedExecution> => {
	const pending = start(source);
	return {
		result: await pending.execution.completed,
		stdout: pending.stdout,
		stderr: pending.stderr
	};
};

beforeEach(() => {
	mock.restore();
	shellState = createShellState();
});

	describe('pipeline execution', () => {
	test('streams bytes and actions across every pipeline boundary', async () => {
		const execution = await execute('ls | cat | cat');

		expect(execution.result.exitCode).toBe(asExitCode(0));
		expect(execution.result.processes).toHaveLength(3);
		expect(execution.result.processes.map((process) => process.argv)).toEqual([
			['ls'],
			['cat'],
			['cat']
		]);
		expect(textOf(execution.stdout)).toContain('projects/');
		expect(
			execution.stdout.flatMap((chunk) => chunk.actions).map((action) => action.command)
		).toContain('cd projects/ && ls -la');
	});

	test('uses the final stage status while retaining each process status', async () => {
		const execution = await execute('cat missing.txt | cat');

		expect(execution.result.processes.map((process) => process.exitCode)).toEqual([
			asExitCode(1),
			asExitCode(0)
		]);
		expect(execution.result.exitCode).toBe(asExitCode(0));
		expect(textOf(execution.stderr)).toContain(
			'cat: no such file or directory: missing.txt'
		);
	});
});

describe('logical AND execution', () => {
	test('applies cwd effects before running the next pipeline', async () => {
		const execution = await execute('cd projects/ && ls -la');

		expect(execution.result.exitCode).toBe(asExitCode(0));
		expect(execution.result.processes.map((process) => process.argv)).toEqual([
			['cd', 'projects/'],
			['ls', '-la']
		]);
		expect(execution.result.effects).toEqual([
			{ kind: 'chdir', path: asAbsolutePath('/app/projects') }
		]);
		expect(shellState.cwd).toBe(asAbsolutePath('/app/projects'));
		expect(textOf(execution.stdout)).toContain('plank.txt');
	});

	test('short-circuits after a failed pipeline', async () => {
		const execution = await execute('cd missing/ && ls -la');

		expect(execution.result.exitCode).toBe(asExitCode(1));
		expect(execution.result.processes.map((process) => process.argv)).toEqual([
			['cd', 'missing/']
		]);
		expect(shellState.cwd).toBe(asAbsolutePath('/app'));
		expect(textOf(execution.stdout)).toBe('');
	});

	test('does not prepare an unreachable command', async () => {
		const execution = await execute('cat missing.txt && teleport projects');

		expect(execution.result.exitCode).toBe(asExitCode(1));
		expect(execution.result.processes.map((process) => process.argv)).toEqual([
			['cat', 'missing.txt']
		]);
		expect(textOf(execution.stderr)).not.toContain('teleport');
	});

	test('stops after an exit effect', async () => {
		const execution = await execute('exit && ls');

		expect(execution.result.exitCode).toBe(asExitCode(0));
		expect(execution.result.processes.map((process) => process.argv)).toEqual([
			['exit']
		]);
		expect(execution.result.effects).toEqual([{ kind: 'exit' }]);
	});
});

describe('shell failures', () => {
	test('returns 127 for an unknown command', async () => {
		const execution = await execute('teleport projects');

		expect(execution.result).toEqual({
			exitCode: asExitCode(127),
			processes: [],
			effects: []
		});
		expect(textOf(execution.stderr)).toBe('teleport: command not found\n');
	});

	test.each([
		['cat README.md & cat', 'command operators are not supported'],
		['cat &&', 'pipeline stages cannot be empty'],
		['cat |', 'pipeline stages cannot be empty'],
		['"unterminated', 'unterminated double-quoted string']
	])('returns 2 for syntax errors: %s', async (source, message) => {
		const execution = await execute(source);

		expect(execution.result).toEqual({
			exitCode: asExitCode(2),
			processes: [],
			effects: []
		});
		expect(textOf(execution.stderr)).toContain(`bash: ${message}`);
	});
});

describe('cancellation', () => {
	test.each([
		['curl https://example.com/slow', 1],
		['curl https://example.com/slow | cat', 2],
		['curl https://example.com/slow && ls', 1]
	] as const)('aborts a running command graph and reports status 130: %s', async (source, processCount) => {
		const request = spyOn(httpClient, 'request').mockImplementation(
			async (_url, init) =>
				await new Promise<Response>((_resolve, reject) => {
					const signal = init.signal;
					if (signal === null || signal === undefined) {
						reject(new Error('missing request AbortSignal'));
						return;
					}

					if (signal.aborted) {
						reject(signal.reason);
						return;
					}

					signal.addEventListener('abort', () => reject(signal.reason), {
						once: true
					});
				})
		);
		const pending = start(source);

		await Bun.sleep(0);
		expect(request).toHaveBeenCalledTimes(1);
		pending.execution.abort();

		const result = await pending.execution.completed;
		expect(result.exitCode).toBe(asExitCode(130));
		expect(result.processes).toHaveLength(processCount);
		expect(result.processes.map((process) => process.exitCode)).toEqual(
			Array.from({ length: processCount }, () => asExitCode(130))
		);
	});

	test('retains earlier effects and skips later pipelines when the RHS is cancelled', async () => {
		const request = spyOn(httpClient, 'request').mockImplementation(
			async (_url, init) =>
				await new Promise<Response>((_resolve, reject) => {
					const signal = init.signal;
					if (signal === null || signal === undefined) {
						reject(new Error('missing request AbortSignal'));
						return;
					}

					if (signal.aborted) {
						reject(signal.reason);
						return;
					}

					signal.addEventListener('abort', () => reject(signal.reason), {
						once: true
					});
				})
		);
		const pending = start('cd projects/ && curl https://example.com/slow && ls');

		await Bun.sleep(0);
		expect(request).toHaveBeenCalledTimes(1);
		pending.execution.abort();

		const result = await pending.execution.completed;
		expect(result.exitCode).toBe(asExitCode(130));
		expect(result.processes.map((process) => process.argv)).toEqual([
			['cd', 'projects/'],
			['curl', 'https://example.com/slow']
		]);
		expect(result.processes.map((process) => process.exitCode)).toEqual([
			asExitCode(0),
			asExitCode(130)
		]);
		expect(result.effects).toEqual([
			{ kind: 'chdir', path: asAbsolutePath('/app/projects') }
		]);
		expect(shellState.cwd).toBe(asAbsolutePath('/app/projects'));
	});
});
