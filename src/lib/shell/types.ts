export type Brand<Value, Name extends string> = Value & {
	readonly __brand: Name;
};

export type AbsolutePath = Brand<string, 'AbsolutePath'>;
export type Pid = Brand<number, 'Pid'>;
export type ExitCode = Brand<number, 'ExitCode'>;

export type CommandActionBehavior = 'execute' | 'prefill';

export type CommandAction = Readonly<{
	label: string;
	command: string;
	behavior: CommandActionBehavior;
}>;

export type FileChunk = Readonly<{
	bytes: Uint8Array;
	actions: readonly CommandAction[];
}>;

export type FileDescriptorOperation = 'read' | 'write' | 'close';

export type FileDescriptorErrorKind =
	| 'closed'
	| 'bad-file-descriptor'
	| 'broken-pipe'
	| 'aborted';

export type FileDescriptorError = Readonly<{
	kind: FileDescriptorErrorKind;
	operation: FileDescriptorOperation;
	message: string;
	reason?: unknown;
}>;

export type FileDescriptorKind = 'file' | 'pipe' | 'terminal' | 'eof';
export type FileDescriptorAccess = 'read' | 'write' | 'readwrite';

export type FileDescriptor = Readonly<{
	kind: FileDescriptorKind;
	access: FileDescriptorAccess;
	isTerminal: boolean;

	read: (signal?: AbortSignal) => Promise<FileChunk | null>;
	write: (chunk: FileChunk, signal?: AbortSignal) => Promise<void>;
	close: () => Promise<void>;
	abort: (reason?: unknown) => Promise<void>;
}>;

export type ProcessIO = Readonly<{
	stdin: FileDescriptor;
	stdout: FileDescriptor;
	stderr: FileDescriptor;
}>;

export type ProcessEffect =
	| Readonly<{
			kind: 'chdir';
			path: AbsolutePath;
	  }>
	| Readonly<{
			kind: 'split';
	  }>;

export type ProcessExit = Readonly<{
	exitCode: ExitCode;
	effects: readonly ProcessEffect[];
}>;

export type ProcessContext = ProcessIO &
	Readonly<{
		pid: Pid;
		argv: readonly string[];
		cwd: AbsolutePath;
		oldCwd: AbsolutePath;
		signal: AbortSignal;
	}>;

export type Pipe = Readonly<{
	reader: FileDescriptor;
	writer: FileDescriptor;
}>;

export type TerminalStream = 'stdout' | 'stderr';

export type TerminalChunkReceiver = (
	stream: TerminalStream,
	chunk: FileChunk
) => void;
