import { z } from 'zod';

import { portfolioRoot, portfolioSeed } from './portfolio';
import type { PortfolioFileSeed, PortfolioSeedEntry } from './portfolio';
import {
	asAbsolutePath,
	createFileDescriptorError,
	FileChunkSchema
} from './schemas';
import type {
	AbsolutePath,
	FileChunk,
	FileDescriptor,
	FileDescriptorAccess,
	FileDescriptorError,
	FileDescriptorOperation,
	Pipe,
	TerminalChunkReceiver,
	TerminalStream
} from './types';

const encoder = new TextEncoder();

export const DEFAULT_PIPE_CAPACITY_BYTES = 64 * 1_024;

const PipeCapacitySchema = z.number().int().positive();

type DescriptorLifecycle =
	| { state: 'open' }
	| { state: 'closed' }
	| { state: 'aborted'; reason?: unknown };

export type MemoryFileDescriptorOptions = Readonly<{
	access?: FileDescriptorAccess;
	isTerminal?: boolean;
}>;

type QueuedChunk = Readonly<{
	chunk: FileChunk;
	capacityCost: number;
}>;

type Waiter = () => void;

const freezeChunk = (input: unknown): FileChunk => {
	const parsed = FileChunkSchema.parse(input);
	const actions = parsed.actions.map((action) => Object.freeze({ ...action }));
	const presentation =
		parsed.presentation === undefined
			? undefined
			: Object.freeze({ ...parsed.presentation });

	return Object.freeze({
		bytes: parsed.bytes.slice(),
		actions: Object.freeze(actions),
		...(presentation === undefined ? {} : { presentation })
	});
};

const descriptorError = (
	kind: 'closed' | 'bad-file-descriptor' | 'broken-pipe' | 'aborted',
	operation: FileDescriptorOperation,
	message: string,
	reason?: unknown
): FileDescriptorError =>
	createFileDescriptorError(
		reason === undefined
			? { kind, operation, message }
			: { kind, operation, message, reason }
	);

const assertOpen = (
	lifecycle: DescriptorLifecycle,
	operation: FileDescriptorOperation,
	label: string
): void => {
	if (lifecycle.state === 'aborted') {
		throw descriptorError(
			'aborted',
			operation,
			`${label} was aborted`,
			lifecycle.reason
		);
	}

	if (lifecycle.state === 'closed') {
		throw descriptorError('closed', operation, `${label} is closed`);
	}
};

const assertSignal = (
	signal: AbortSignal | undefined,
	operation: FileDescriptorOperation,
	label: string
): void => {
	if (signal?.aborted) {
		throw descriptorError(
			'aborted',
			operation,
			`${label} operation was aborted`,
			signal.reason
		);
	}
};

const badFileDescriptor = (
	operation: 'read' | 'write',
	label: string
): never => {
	throw descriptorError(
		'bad-file-descriptor',
		operation,
		`${label} is not ${operation === 'read' ? 'readable' : 'writable'}`
	);
};

const wakeAll = (waiters: Set<Waiter>): void => {
	for (const wake of [...waiters]) {
		wake();
	}
};

const waitForChange = async (
	waiters: Set<Waiter>,
	signal: AbortSignal | undefined,
	operation: 'read' | 'write',
	label: string
): Promise<void> => {
	assertSignal(signal, operation, label);

	await new Promise<void>((resolve, reject) => {
		let settled = false;

		const cleanup = () => {
			waiters.delete(wake);
			signal?.removeEventListener('abort', onAbort);
		};

		const settle = (finish: () => void) => {
			if (settled) {
				return;
			}

			settled = true;
			cleanup();
			finish();
		};

		const wake = () => settle(resolve);
		const onAbort = () =>
			settle(() =>
				reject(
					descriptorError(
						'aborted',
						operation,
						`${label} operation was aborted`,
						signal?.reason
					)
				)
			);

		waiters.add(wake);
		signal?.addEventListener('abort', onAbort, { once: true });
	});
};

export const createEofFileDescriptor = (): FileDescriptor => {
	let lifecycle: DescriptorLifecycle = { state: 'open' };

	return {
		kind: 'eof',
		access: 'read',
		isTerminal: false,

		read: async (signal) => {
			assertOpen(lifecycle, 'read', 'stdin');
			assertSignal(signal, 'read', 'stdin');
			return null;
		},

		write: async () => badFileDescriptor('write', 'EOF descriptor'),

		close: async () => {
			if (lifecycle.state === 'open') {
				lifecycle = { state: 'closed' };
			}
		},

		abort: async (reason) => {
			if (lifecycle.state === 'open') {
				lifecycle = { state: 'aborted', reason };
			}
		}
	};
};

export const createTerminalFileDescriptor = (
	stream: TerminalStream,
	receive: TerminalChunkReceiver
): FileDescriptor => {
	let lifecycle: DescriptorLifecycle = { state: 'open' };

	return {
		kind: 'terminal',
		access: 'write',
		isTerminal: true,

		read: async () => badFileDescriptor('read', stream),

		write: async (input, signal) => {
			assertOpen(lifecycle, 'write', stream);
			assertSignal(signal, 'write', stream);
			receive(stream, freezeChunk(input));
		},

		close: async () => {
			if (lifecycle.state === 'open') {
				lifecycle = { state: 'closed' };
			}
		},

		abort: async (reason) => {
			if (lifecycle.state === 'open') {
				lifecycle = { state: 'aborted', reason };
			}
		}
	};
};

export const createMemoryFileDescriptor = (
	initialChunks: readonly FileChunk[] = [],
	options: MemoryFileDescriptorOptions = {}
): FileDescriptor => {
	const access = options.access ?? 'read';
	const chunks = initialChunks.map(freezeChunk);
	let readIndex = 0;
	let lifecycle: DescriptorLifecycle = { state: 'open' };

	return {
		kind: 'file',
		access,
		isTerminal: options.isTerminal ?? false,

		read: async (signal) => {
			if (access === 'write') {
				return badFileDescriptor('read', 'file descriptor');
			}

			assertOpen(lifecycle, 'read', 'file descriptor');
			assertSignal(signal, 'read', 'file descriptor');

			const chunk = chunks[readIndex];
			if (chunk === undefined) {
				return null;
			}

			readIndex += 1;
			return freezeChunk(chunk);
		},

		write: async (input, signal) => {
			if (access === 'read') {
				return badFileDescriptor('write', 'file descriptor');
			}

			assertOpen(lifecycle, 'write', 'file descriptor');
			assertSignal(signal, 'write', 'file descriptor');
			chunks.push(freezeChunk(input));
		},

		close: async () => {
			if (lifecycle.state === 'open') {
				lifecycle = { state: 'closed' };
			}
		},

		abort: async (reason) => {
			if (lifecycle.state === 'open') {
				lifecycle = { state: 'aborted', reason };
			}
		}
	};
};

export const createPipe = (
	capacityBytes = DEFAULT_PIPE_CAPACITY_BYTES
): Pipe => {
	const capacity = PipeCapacitySchema.parse(capacityBytes);
	const queue: QueuedChunk[] = [];
	const readers = new Set<Waiter>();
	const writers = new Set<Waiter>();
	let bufferedCapacity = 0;
	let readerClosed = false;
	let writerClosed = false;
	let acceptingWrites = true;
	let aborted = false;
	let abortReason: unknown;
	let writeTail: Promise<void> = Promise.resolve();
	let closeWriterPromise: Promise<void> | undefined;

	const assertPipeActive = (
		operation: 'read' | 'write',
		signal?: AbortSignal
	): void => {
		if (aborted) {
			throw descriptorError(
				'aborted',
				operation,
				'pipe was aborted',
				abortReason
			);
		}

		assertSignal(signal, operation, 'pipe');
	};

	const enqueue = async (
		input: FileChunk,
		signal?: AbortSignal
	): Promise<void> => {
		const chunk = freezeChunk(input);
		let offset = 0;
		let firstFragment = true;
		const isEmpty = chunk.bytes.byteLength === 0;

		while (isEmpty ? firstFragment : offset < chunk.bytes.byteLength) {
			assertPipeActive('write', signal);

			if (readerClosed) {
				throw descriptorError(
					'broken-pipe',
					'write',
					'pipe reader is closed'
				);
			}

			const availableCapacity = capacity - bufferedCapacity;
			if (availableCapacity === 0) {
				await waitForChange(writers, signal, 'write', 'pipe');
				continue;
			}

			const byteCount = isEmpty
				? 0
				: Math.min(availableCapacity, chunk.bytes.byteLength - offset);
			const capacityCost = Math.max(1, byteCount);
			const bytes = chunk.bytes.slice(offset, offset + byteCount);
			const actions = firstFragment ? chunk.actions : [];
			const presentation = firstFragment ? chunk.presentation : undefined;

			queue.push({
				chunk: freezeChunk({
					bytes,
					actions,
					...(presentation === undefined ? {} : { presentation })
				}),
				capacityCost
			});
			bufferedCapacity += capacityCost;
			offset += byteCount;
			firstFragment = false;
			wakeAll(readers);
		}
	};

	const abortPipe = (reason?: unknown): void => {
		if (aborted) {
			return;
		}

		aborted = true;
		abortReason = reason;
		acceptingWrites = false;
		queue.length = 0;
		bufferedCapacity = 0;
		wakeAll(readers);
		wakeAll(writers);
	};

	const reader: FileDescriptor = {
		kind: 'pipe',
		access: 'read',
		isTerminal: false,

		read: async (signal) => {
			while (true) {
				assertPipeActive('read', signal);

				if (readerClosed) {
					throw descriptorError('closed', 'read', 'pipe reader is closed');
				}

				const queued = queue.shift();
				if (queued !== undefined) {
					bufferedCapacity -= queued.capacityCost;
					wakeAll(writers);
					return queued.chunk;
				}

				if (writerClosed) {
					return null;
				}

				await waitForChange(readers, signal, 'read', 'pipe');
			}
		},

		write: async () => badFileDescriptor('write', 'pipe reader'),

		close: async () => {
			if (readerClosed) {
				return;
			}

			readerClosed = true;
			queue.length = 0;
			bufferedCapacity = 0;
			wakeAll(readers);
			wakeAll(writers);
		},

		abort: async (reason) => abortPipe(reason)
	};

	const writer: FileDescriptor = {
		kind: 'pipe',
		access: 'write',
		isTerminal: false,

		read: async () => badFileDescriptor('read', 'pipe writer'),

		write: (input, signal) => {
			if (aborted) {
				return Promise.reject(
					descriptorError(
						'aborted',
						'write',
						'pipe was aborted',
						abortReason
					)
				);
			}

			if (!acceptingWrites || writerClosed) {
				return Promise.reject(
					descriptorError('closed', 'write', 'pipe writer is closed')
				);
			}

			const chunk = freezeChunk(input);
			const operation = writeTail.then(() => enqueue(chunk, signal));
			writeTail = operation.catch(() => undefined);
			return operation;
		},

		close: () => {
			if (closeWriterPromise !== undefined) {
				return closeWriterPromise;
			}

			acceptingWrites = false;
			closeWriterPromise = writeTail.then(() => {
				if (!aborted) {
					writerClosed = true;
					wakeAll(readers);
				}
			});
			return closeWriterPromise;
		},

		abort: async (reason) => abortPipe(reason)
	};

	return Object.freeze({ reader, writer });
};

export const FileSystemErrorSchema = z
	.object({
		kind: z.enum(['not-found', 'not-directory', 'is-directory', 'invalid-path']),
		operation: z.enum(['resolve', 'stat', 'read-directory', 'open']),
		path: z.string(),
		message: z.string().min(1)
	})
	.strict();

export type FileSystemError = z.infer<typeof FileSystemErrorSchema>;
export type FileSystemOperation = FileSystemError['operation'];
export type VirtualFileKind = PortfolioSeedEntry['kind'];

export type VirtualFileStat = Readonly<{
	path: AbsolutePath;
	name: string;
	kind: VirtualFileKind;
	size: number;
	modifiedAt: string;
}>;

export type VirtualDirectoryEntry = VirtualFileStat;
export type VirtualPngAsset = NonNullable<PortfolioFileSeed['asset']>;

export type VirtualFileSystem = Readonly<{
	initialDirectory: AbsolutePath;
	resolve: (cwd: AbsolutePath, path: string) => AbsolutePath;
	stat: (cwd: AbsolutePath, path: string) => Promise<VirtualFileStat>;
	readDirectory: (
		cwd: AbsolutePath,
		path: string
	) => Promise<readonly VirtualDirectoryEntry[]>;
	open: (cwd: AbsolutePath, path: string) => Promise<FileDescriptor>;
	readPngAsset: (
		cwd: AbsolutePath,
		path: string
	) => Promise<VirtualPngAsset | null>;
}>;

export const createFileSystemError = (error: FileSystemError): FileSystemError =>
	FileSystemErrorSchema.parse(error);

const nodes = new Map<string, PortfolioSeedEntry>();

for (const entry of portfolioSeed) {
	if (nodes.has(entry.path)) {
		throw new Error(`duplicate virtual filesystem path: ${entry.path}`);
	}

	nodes.set(entry.path, entry);
}

const parentPath = (path: AbsolutePath): AbsolutePath | null => {
	if (path === '/') {
		return null;
	}

	const separatorIndex = path.lastIndexOf('/');
	return asAbsolutePath(separatorIndex === 0 ? '/' : path.slice(0, separatorIndex));
};

for (const entry of portfolioSeed) {
	const parent = parentPath(entry.path);

	if (parent === null) {
		continue;
	}

	const parentNode = nodes.get(parent);

	if (parentNode?.kind !== 'directory') {
		throw new Error(`missing virtual parent directory ${parent} for ${entry.path}`);
	}
}

const resolve = (cwd: AbsolutePath, input: string): AbsolutePath => {
	if (input.includes('\0')) {
		throw createFileSystemError({
			kind: 'invalid-path',
			operation: 'resolve',
			path: input,
			message: `invalid path: ${input}`
		});
	}

	if (input.startsWith('~')) {
		throw createFileSystemError({
			kind: 'invalid-path',
			operation: 'resolve',
			path: input,
			message: `home directories are not available: ${input.split('/')[0]}`
		});
	}

	const source = input.startsWith('/')
		? input
		: `${cwd}${cwd === '/' ? '' : '/'}${input}`;
	const segments: string[] = [];

	for (const segment of source.split('/')) {
		if (segment === '' || segment === '.') {
			continue;
		}

		if (segment === '..') {
			segments.pop();
			continue;
		}

		segments.push(segment);
	}

	return asAbsolutePath(`/${segments.join('/')}`);
};

const getNode = (
	cwd: AbsolutePath,
	path: string,
	operation: Exclude<FileSystemOperation, 'resolve'>
): PortfolioSeedEntry => {
	const absolutePath = resolve(cwd, path);
	const node = nodes.get(absolutePath);

	if (node === undefined) {
		throw createFileSystemError({
			kind: 'not-found',
			operation,
			path: absolutePath,
			message: `no such file or directory: ${path}`
		});
	}

	return node;
};

const nodeName = (path: AbsolutePath): string => {
	if (path === '/') {
		return '/';
	}

	return path.slice(path.lastIndexOf('/') + 1);
};

const toStat = (node: PortfolioSeedEntry): VirtualFileStat => ({
	path: node.path,
	name: nodeName(node.path),
	kind: node.kind,
	size: node.kind === 'directory' ? 4_096 : encoder.encode(node.content).byteLength,
	modifiedAt: node.modifiedAt
});

const stat = async (cwd: AbsolutePath, path: string): Promise<VirtualFileStat> =>
	toStat(getNode(cwd, path, 'stat'));

const readDirectory = async (
	cwd: AbsolutePath,
	path: string
): Promise<readonly VirtualDirectoryEntry[]> => {
	const directory = getNode(cwd, path, 'read-directory');

	if (directory.kind !== 'directory') {
		throw createFileSystemError({
			kind: 'not-directory',
			operation: 'read-directory',
			path: directory.path,
			message: `not a directory: ${path}`
		});
	}

	return portfolioSeed
		.filter((candidate) => parentPath(candidate.path) === directory.path)
		.map(toStat)
		.sort((left, right) => {
			if (left.name < right.name) return -1;
			if (left.name > right.name) return 1;
			return 0;
		});
};

const open = async (cwd: AbsolutePath, path: string): Promise<FileDescriptor> => {
	const file = getNode(cwd, path, 'open');

	if (file.kind === 'directory') {
		throw createFileSystemError({
			kind: 'is-directory',
			operation: 'open',
			path: file.path,
			message: `is a directory: ${path}`
		});
	}

	return createMemoryFileDescriptor([
		{
			bytes: encoder.encode(file.content),
			actions: file.actions
		}
	]);
};

const readPngAsset = async (
	cwd: AbsolutePath,
	path: string
): Promise<VirtualPngAsset | null> => {
	const file = getNode(cwd, path, 'open');
	if (file.kind === 'directory') {
		throw createFileSystemError({
			kind: 'is-directory',
			operation: 'open',
			path: file.path,
			message: `is a directory: ${path}`
		});
	}

	return file.asset ?? null;
};

export const filesystem: VirtualFileSystem = {
	initialDirectory: portfolioRoot,
	resolve,
	stat,
	readDirectory,
	open,
	readPngAsset
};
