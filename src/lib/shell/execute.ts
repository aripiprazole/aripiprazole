import { z } from 'zod';

import {
	applyProcessEffects,
	type ShellState,
	isCommandArgumentError,
	prepareCommand,
	type PreparedCommand
} from './commands';
import { createPipe } from './filesystem';
import {
	isShellParseError,
	parseCommandList,
	type ParsedPipeline
} from './parser';
import { asExitCode, asPid } from './schemas';
import type {
	ExitCode,
	FileDescriptor,
	Pipe,
	ProcessContext,
	ProcessEffect,
	ProcessExit,
	ProcessIO
} from './types';

const encoder = new TextEncoder();

export type ProcessSummary = Readonly<{
	pid: number;
	argv: readonly string[];
	exitCode: ExitCode;
}>;

export type PipelineExit = Readonly<{
	exitCode: ExitCode;
	processes: readonly ProcessSummary[];
	effects: readonly ProcessEffect[];
}>;

export type ShellExecution = Readonly<{
	completed: Promise<PipelineExit>;
	abort: () => void;
}>;

const writeError = async (
	stderr: FileDescriptor,
	message: string,
	signal: AbortSignal
): Promise<void> => {
	try {
		await stderr.write(
			{
				bytes: encoder.encode(`${message}\n`),
				actions: []
			},
			signal
		);
	} catch {
		// The original failure is more useful than a secondary closed-stderr error.
	}
};

const preparePipeline = (pipeline: ParsedPipeline): readonly PreparedCommand[] => {
	return pipeline.stages.map((stage) => prepareCommand(stage.argv));
};

const processErrorMessage = (error: unknown): string => {
	if (error instanceof z.ZodError) {
		return error.issues[0]?.message ?? 'invalid arguments';
	}

	if (error instanceof Error && error.message.length > 0) return error.message;
	if (typeof error === 'object' && error !== null && 'message' in error) {
		const message = Reflect.get(error, 'message');
		if (typeof message === 'string' && message.length > 0) return message;
	}

	return 'unexpected process failure';
};

const startProcess = async (
	command: PreparedCommand,
	context: ProcessContext
): Promise<ProcessExit> => {
	try {
		return await command.run(context);
	} catch (error: unknown) {
		if (context.signal.aborted) {
			return { exitCode: asExitCode(130), effects: [] };
		}

		await writeError(
			context.stderr,
			`${command.name}: ${processErrorMessage(error)}`,
			context.signal
		);
		return { exitCode: asExitCode(1), effects: [] };
	}
};

const processIO = (
	index: number,
	stageCount: number,
	pipes: readonly Pipe[],
	terminalIO: ProcessIO
): ProcessIO => ({
	stdin: index === 0 ? terminalIO.stdin : pipes[index - 1]!.reader,
	stdout: index === stageCount - 1 ? terminalIO.stdout : pipes[index]!.writer,
	stderr: terminalIO.stderr
});

const closeOwnedPipeEnds = async (io: ProcessIO): Promise<void> => {
	const closes: Promise<void>[] = [];
	if (io.stdin.kind === 'pipe') closes.push(io.stdin.close());
	if (io.stdout.kind === 'pipe') closes.push(io.stdout.close());
	await Promise.allSettled(closes);
};

const runPipeline = async (
	commands: readonly PreparedCommand[],
	pipes: readonly Pipe[],
	terminalIO: ProcessIO,
	shellState: ShellState,
	controller: AbortController
): Promise<PipelineExit> => {
	const cwd = shellState.cwd;
	const running = commands.map((command, index) => {
		const pid = asPid(shellState.nextPid++);
		const io = processIO(index, commands.length, pipes, terminalIO);
		const context: ProcessContext = {
			...io,
			pid,
			argv: command.argv,
			cwd,
			oldCwd: shellState.oldCwd,
			signal: controller.signal
		};

		return (async (): Promise<ProcessSummary & { effects: ProcessExit['effects'] }> => {
			try {
				const result = await startProcess(command, context);
				return { pid, argv: command.argv, exitCode: result.exitCode, effects: result.effects };
			} finally {
				await closeOwnedPipeEnds(io);
			}
		})();
	});

	const results = await Promise.all(running);
	const finalResult = results.at(-1);
	if (finalResult === undefined) {
		return { exitCode: asExitCode(2), processes: [], effects: [] };
	}

	const effects =
		results.length === 1 && finalResult.exitCode === 0
			? finalResult.effects
			: [];
	if (results.length === 1 && finalResult.exitCode === 0) {
		applyProcessEffects(shellState, effects);
	}

	return {
		exitCode: finalResult.exitCode,
		processes: results.map(({ pid, argv, exitCode }) => ({ pid, argv, exitCode })),
		effects
	};
};

export const executeShell = (
	source: string,
	terminalIO: ProcessIO,
	shellState: ShellState
): ShellExecution => {
	const controller = new AbortController();
	let pipes: readonly Pipe[] = [];

	const completed = (async (): Promise<PipelineExit> => {
		const processes: ProcessSummary[] = [];
		const effects: ProcessEffect[] = [];
		const result = (exitCode: ExitCode): PipelineExit => ({
			exitCode,
			processes,
			effects
		});

		try {
			const commandList = parseCommandList(source);
			let exitCode = asExitCode(0);

			for (const pipeline of commandList.pipelines) {
				if (controller.signal.aborted) return result(asExitCode(130));

				const prepared = preparePipeline(pipeline);
				pipes = Array.from({ length: Math.max(0, prepared.length - 1) }, () => createPipe());
				const pipelineResult = await runPipeline(
					prepared,
					pipes,
					terminalIO,
					shellState,
					controller
				);
				pipes = [];
				processes.push(...pipelineResult.processes);
				effects.push(...pipelineResult.effects);
				exitCode = pipelineResult.exitCode;

				if (
					exitCode !== 0 ||
					pipelineResult.effects.some((effect) => effect.kind === 'exit')
				) {
					break;
				}
			}

			return result(exitCode);
		} catch (error: unknown) {
			if (controller.signal.aborted) {
				return result(asExitCode(130));
			}

			if (isShellParseError(error)) {
				await writeError(terminalIO.stderr, `bash: ${error.message}`, controller.signal);
				return result(asExitCode(2));
			}

			if (isCommandArgumentError(error)) {
				const exitCode = error.message === 'command not found' ? 127 : 2;
				await writeError(
					terminalIO.stderr,
					`${error.command}: ${error.message}`,
					controller.signal
				);
				return result(asExitCode(exitCode));
			}

			if (error instanceof z.ZodError) {
				await writeError(
					terminalIO.stderr,
					`bash: ${error.issues[0]?.message ?? 'invalid arguments'}`,
					controller.signal
				);
				return result(asExitCode(2));
			}

			await writeError(
				terminalIO.stderr,
				`bash: ${processErrorMessage(error)}`,
				controller.signal
			);
			return result(asExitCode(1));
		} finally {
			await Promise.allSettled([
				terminalIO.stdin.close(),
				terminalIO.stdout.close(),
				terminalIO.stderr.close()
			]);
		}
	})();

	return {
		completed,
		abort: () => {
			if (controller.signal.aborted) return;
			controller.abort('interrupted');
			for (const pipe of pipes) {
				void pipe.reader.abort('interrupted');
			}
		}
	};
};
