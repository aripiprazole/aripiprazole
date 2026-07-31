import {
	createEofFileDescriptor,
	createTerminalFileDescriptor
} from './shell/filesystem';
import { createShellState } from './shell/commands';
import {
	executeShell,
	type PipelineExit,
	type ShellExecution
} from './shell/execute';
import type {
	AbsolutePath,
	CommandAction,
	ExitCode,
	FileChunk,
	FilePresentation,
	TerminalStream
} from './shell/types';

export type SubmissionSource = 'startup' | 'keyboard' | 'action';
export type TerminalEntryStatus =
	| 'typing-command'
	| 'running'
	| 'typing-output'
	| 'done'
	| 'cancelled';

export type TerminalOutputChunk = {
	id: number;
	stream: TerminalStream;
	text: string;
	visibleText: string;
	actions: readonly CommandAction[];
	presentation?: FilePresentation;
	revealed: boolean;
};

export type TerminalEntry = {
	id: number;
	source: SubmissionSource;
	cwd: AbsolutePath;
	command: string;
	visibleCommand: string;
	status: TerminalEntryStatus;
	chunks: TerminalOutputChunk[];
	exitCode?: ExitCode;
};

export type TerminalCursor =
	| { kind: 'none' }
	| { kind: 'draft' }
	| { kind: 'command'; entryId: number }
	| { kind: 'output'; chunkId: number };

export type TerminalPhase =
	| 'idle'
	| 'typing-command'
	| 'running'
	| 'typing-output';

export type TerminalState = {
	cwd: AbsolutePath;
	draft: string;
	transcript: TerminalEntry[];
	commandHistory: string[];
	historyIndex: number | null;
	queued: number;
	activeExecution: ShellExecution | null;
	activeEntryId: number | null;
	phase: TerminalPhase;
	cursor: TerminalCursor;
	announcement: string;
	scrollVersion: number;
};

export type TerminalControllerOptions = Readonly<{
	initialCwd?: AbsolutePath;
	startupCommands?: readonly string[];
	onSplit?: (cwd: AbsolutePath) => void;
}>;

export type TerminalController = Readonly<{
	state: TerminalState;
	submitCommand: (
		input: string,
		source?: SubmissionSource
	) => Promise<void>;
	activateCommandAction: (action: CommandAction) => void;
	recallPreviousCommand: () => void;
	recallNextCommand: () => void;
	resetHistoryNavigation: () => void;
	abortActiveCommand: () => void;
	clearTranscript: () => void;
	boot: () => void;
	dispose: () => void;
}>;

type Submission = Readonly<{
	command: string;
	source: SubmissionSource;
	resolve: () => void;
}>;

const MAX_HISTORY_ENTRIES = 200;
const MAX_TRANSCRIPT_BYTES = 1_048_576;
const commandDelayMs = 45;
const outputDelayMs = 8;
const maximumCommandAnimationMs = 1_200;
const maximumOutputAnimationMs = 4_000;
const encoder = new TextEncoder();

export const createTerminalController = (
	options: TerminalControllerOptions = {}
): TerminalController => {
	const shellState = createShellState(options.initialCwd);
	const state = $state<TerminalState>({
		cwd: shellState.cwd,
		draft: '',
		transcript: [],
		commandHistory: [],
		historyIndex: null,
		queued: 0,
		activeExecution: null,
		activeEntryId: null,
		phase: 'idle',
		cursor: { kind: 'none' },
		announcement: '',
		scrollVersion: 0
	});

	let booted = false;
	let disposed = false;
	let reducedMotion = false;
	let draining = false;
	let historyScratch = '';
	let nextEntryId = 1;
	let nextChunkId = 1;
	let revealTail: Promise<void> = Promise.resolve();
	const submissions: Submission[] = [];

	const nextFrame = async (): Promise<void> => {
		await new Promise<void>((resolve) => {
			requestAnimationFrame(() => resolve());
		});
	};

	const animateText = async (
		text: string,
		setVisible: (visible: string) => void,
		delayMs: number,
		maximumDurationMs: number
	): Promise<void> => {
		const characters = Array.from(text);
		if (reducedMotion || characters.length === 0) {
			if (!disposed) setVisible(text);
			return;
		}

		const duration = Math.min(maximumDurationMs, characters.length * delayMs);
		const start = performance.now();
		let visibleCharacters = 0;

		while (!disposed && visibleCharacters < characters.length) {
			await nextFrame();
			const elapsed = performance.now() - start;
			const expected = Math.ceil((elapsed / Math.max(duration, 1)) * characters.length);
			visibleCharacters = Math.min(
				characters.length,
				Math.max(visibleCharacters + 1, expected)
			);
			setVisible(characters.slice(0, visibleCharacters).join(''));
		}
	};

	const transcriptBytes = (): number =>
		state.transcript.reduce(
			(total, entry) =>
				total +
				encoder.encode(entry.command).byteLength +
				entry.chunks.reduce(
					(chunkTotal, output) => chunkTotal + encoder.encode(output.text).byteLength,
					0
				),
			0
		);

	const pruneTranscript = (): void => {
		while (
			state.transcript.length > MAX_HISTORY_ENTRIES ||
			transcriptBytes() > MAX_TRANSCRIPT_BYTES
		) {
			const first = state.transcript[0];
			if (first?.id === state.activeEntryId) return;
			state.transcript.shift();
		}
	};

	const appendChunk = (
		entry: TerminalEntry,
		stream: TerminalStream,
		text: string,
		actions: readonly CommandAction[],
		presentation?: FilePresentation
	): void => {
		if (
			disposed ||
			(text.length === 0 && actions.length === 0 && presentation === undefined)
		) {
			return;
		}

		const pendingOutput: TerminalOutputChunk = {
			id: nextChunkId++,
			stream,
			text,
			visibleText: '',
			actions,
			...(presentation === undefined ? {} : { presentation }),
			revealed: false
		};
		entry.chunks.push(pendingOutput);
		const output = entry.chunks.at(-1);
		if (output === undefined) return;
		state.scrollVersion += 1;

		revealTail = revealTail
			.then(async () => {
				if (disposed) return;
				entry.status = 'typing-output';
				state.phase = 'typing-output';
				state.cursor = { kind: 'output', chunkId: output.id };

				if (output.presentation === undefined) {
					await animateText(
						output.text,
						(visible) => {
							output.visibleText = visible;
							state.scrollVersion += 1;
						},
						outputDelayMs,
						maximumOutputAnimationMs
					);
				}

				if (disposed) return;
				output.revealed = true;
				state.scrollVersion += 1;
			})
			.catch(() => undefined);
	};

	const animateSyntheticCommand = async (command: string): Promise<void> => {
		state.phase = 'typing-command';
		state.cursor = { kind: 'draft' };
		state.draft = '';

		await animateText(
			command,
			(visible) => {
				state.draft = visible;
				state.scrollVersion += 1;
			},
			commandDelayMs,
			maximumCommandAnimationMs
		);
	};

	const rememberCommand = (command: string): void => {
		state.commandHistory.push(command);
		if (state.commandHistory.length > MAX_HISTORY_ENTRIES) {
			state.commandHistory.shift();
		}
		state.historyIndex = null;
		historyScratch = '';
	};

	const runSubmission = async (
		command: string,
		source: SubmissionSource
	): Promise<void> => {
		if (disposed) return;
		if (source !== 'keyboard') await animateSyntheticCommand(command);
		if (disposed) return;

		const pendingEntry: TerminalEntry = {
			id: nextEntryId++,
			source,
			cwd: shellState.cwd,
			command,
			visibleCommand: command,
			status: 'running',
			chunks: []
		};
		state.transcript.push(pendingEntry);
		const entry = state.transcript.at(-1);
		if (entry === undefined) return;
		state.activeEntryId = entry.id;
		state.draft = '';
		state.phase = 'running';
		state.cursor = { kind: 'command', entryId: entry.id };
		state.scrollVersion += 1;
		rememberCommand(command);

		const decoders: Record<TerminalStream, TextDecoder> = {
			stdout: new TextDecoder(),
			stderr: new TextDecoder()
		};
		const receive = (stream: TerminalStream, fileChunk: FileChunk): void => {
			appendChunk(
				entry,
				stream,
				decoders[stream].decode(fileChunk.bytes, { stream: true }),
				fileChunk.actions,
				fileChunk.presentation
			);
		};

		const execution = executeShell(
			command,
			{
				stdin: createEofFileDescriptor(),
				stdout: createTerminalFileDescriptor('stdout', receive),
				stderr: createTerminalFileDescriptor('stderr', receive)
			},
			shellState
		);
		state.activeExecution = execution;

		let result: PipelineExit;
		try {
			result = await execution.completed;
		} finally {
			for (const stream of ['stdout', 'stderr'] as const) {
				const remainder = decoders[stream].decode();
				if (remainder.length > 0) appendChunk(entry, stream, remainder, []);
			}
		}

		await revealTail;
		if (disposed) return;
		entry.exitCode = result.exitCode;
		entry.status = result.exitCode === 130 ? 'cancelled' : 'done';
		state.cwd = shellState.cwd;
		state.activeExecution = null;
		state.activeEntryId = null;
		state.phase = 'idle';
		state.cursor = { kind: 'none' };
		state.announcement = `${command} finished with status ${result.exitCode}`;
		state.scrollVersion += 1;
		pruneTranscript();

		if (result.effects.some((effect) => effect.kind === 'split')) {
			options.onSplit?.(state.cwd);
		}
	};

	const resolvePendingSubmissions = (): void => {
		while (submissions.length > 0) submissions.shift()?.resolve();
		state.queued = 0;
	};

	const drainSubmissions = async (): Promise<void> => {
		if (draining || disposed) return;
		draining = true;

		try {
			while (!disposed && submissions.length > 0) {
				const submission = submissions.shift();
				state.queued = submissions.length;
				if (submission === undefined) continue;

				try {
					await runSubmission(submission.command, submission.source);
				} finally {
					submission.resolve();
				}
			}
		} finally {
			draining = false;
			if (disposed) resolvePendingSubmissions();
			else state.queued = submissions.length;
		}
	};

	const submitCommand = (
		input: string,
		source: SubmissionSource = 'keyboard'
	): Promise<void> => {
		const command = input.trim();
		if (disposed || command.length === 0) return Promise.resolve();

		return new Promise<void>((resolve) => {
			submissions.push({ command, source, resolve });
			state.queued = submissions.length;
			void drainSubmissions();
		});
	};

	const activateCommandAction = (action: CommandAction): void => {
		if (disposed) return;
		if (action.behavior === 'prefill') {
			state.draft = action.command;
			state.historyIndex = null;
			state.announcement = `Inserted ${action.command}`;
			return;
		}

		void submitCommand(action.command, 'action');
	};

	const recallPreviousCommand = (): void => {
		if (state.commandHistory.length === 0) return;

		if (state.historyIndex === null) {
			historyScratch = state.draft;
			state.historyIndex = state.commandHistory.length - 1;
		} else {
			state.historyIndex = Math.max(0, state.historyIndex - 1);
		}

		state.draft = state.commandHistory[state.historyIndex] ?? state.draft;
	};

	const recallNextCommand = (): void => {
		if (state.historyIndex === null) return;

		if (state.historyIndex >= state.commandHistory.length - 1) {
			state.historyIndex = null;
			state.draft = historyScratch;
			return;
		}

		state.historyIndex += 1;
		state.draft = state.commandHistory[state.historyIndex] ?? state.draft;
	};

	const resetHistoryNavigation = (): void => {
		state.historyIndex = null;
		historyScratch = state.draft;
	};

	const abortActiveCommand = (): void => {
		const active = state.activeExecution;
		if (active === null) {
			state.draft = '';
			return;
		}

		const entry = state.transcript.find(
			(candidate) => candidate.id === state.activeEntryId
		);
		if (entry !== undefined) appendChunk(entry, 'stderr', '^C\n', []);
		active.abort();
		state.announcement = 'Command interrupted';
	};

	const clearTranscript = (): void => {
		state.transcript =
			state.activeEntryId === null
				? []
				: state.transcript.filter((entry) => entry.id === state.activeEntryId);
		state.scrollVersion += 1;
	};

	const boot = (): void => {
		if (booted || disposed) return;
		booted = true;
		reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		void (async () => {
			for (const command of options.startupCommands ?? []) {
				if (disposed) return;
				await submitCommand(command, 'startup');
			}
		})();
	};

	const dispose = (): void => {
		if (disposed) return;
		disposed = true;
		state.activeExecution?.abort();
		state.activeExecution = null;
		resolvePendingSubmissions();
	};

	return {
		state,
		submitCommand,
		activateCommandAction,
		recallPreviousCommand,
		recallNextCommand,
		resetHistoryNavigation,
		abortActiveCommand,
		clearTranscript,
		boot,
		dispose
	};
};
