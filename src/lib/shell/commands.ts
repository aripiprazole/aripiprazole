import { z } from 'zod';

import { filesystem, FileSystemErrorSchema } from './filesystem';
import { asExitCode, FileDescriptorErrorSchema } from './schemas';
import type {
	AbsolutePath,
	CommandAction,
	FileChunk,
	FileDescriptor,
	ProcessContext,
	ProcessExit
} from './types';

const encoder = new TextEncoder();

const CatArgumentsSchema = z
	.object({
		paths: z.array(z.string()).max(63)
	})
	.strict();

const LsArgumentsSchema = z
	.object({
		all: z.boolean(),
		long: z.boolean(),
		humanReadable: z.boolean(),
		onePerLine: z.boolean(),
		paths: z.array(z.string()).max(63)
	})
	.strict();

const CdArgumentsSchema = z
	.object({
		path: z.string().optional()
	})
	.strict();

const PwdArgumentsSchema = z.object({}).strict();

const SplitArgumentsSchema = z.object({}).strict();

const CurlArgumentsSchema = z
	.object({
		url: z.string().min(1).max(2_048),
		head: z.boolean(),
		includeHeaders: z.boolean(),
		maxTimeMs: z.number().int().min(100).max(5_000),
		maxBytes: z.number().int().min(1).max(65_536)
	})
	.strict();

const CommandArgumentErrorSchema = z
	.object({
		kind: z.literal('command-arguments'),
		command: z.string().min(1),
		message: z.string().min(1)
	})
	.strict();

export type CommandArgumentError = z.infer<typeof CommandArgumentErrorSchema>;

export type CommandCompletionOperand =
	| 'none'
	| 'file'
	| 'directory'
	| 'path'
	| 'url';

export type CommandCompletion = Readonly<{
	options: readonly string[];
	operand: CommandCompletionOperand;
}>;

export type CommandDefinition<Schema extends z.ZodType> = Readonly<{
	usage: string;
	completion: CommandCompletion;
	schema: Schema;
	normalize: (argv: readonly string[]) => unknown;
	run: (
		context: ProcessContext,
		arguments_: z.output<Schema>
	) => Promise<ProcessExit>;
}>;

export type PreparedCommand = Readonly<{
	name: string;
	argv: readonly string[];
	run: (context: ProcessContext) => Promise<ProcessExit>;
}>;

const commandArgumentError = (
	command: string,
	message: string
): CommandArgumentError =>
	CommandArgumentErrorSchema.parse({
		kind: 'command-arguments',
		command,
		message
	});

export const isCommandArgumentError = (
	error: unknown
): error is CommandArgumentError => CommandArgumentErrorSchema.safeParse(error).success;

const chunk = (
	text: string,
	actions: readonly CommandAction[] = []
): FileChunk => ({
	bytes: encoder.encode(text),
	actions
});

const writeText = async (
	descriptor: FileDescriptor,
	text: string,
	signal: AbortSignal,
	actions: readonly CommandAction[] = []
): Promise<void> => {
	await descriptor.write(chunk(text, actions), signal);
};

const errorMessage = (error: unknown, fallback: string): string => {
	const descriptorError = FileDescriptorErrorSchema.safeParse(error);
	if (descriptorError.success) return descriptorError.data.message;

	const filesystemError = FileSystemErrorSchema.safeParse(error);
	if (filesystemError.success) return filesystemError.data.message;

	if (error instanceof Error && error.message.length > 0) return error.message;
	return fallback;
};

const normalizeCatArguments = (argv: readonly string[]): unknown => {
	const paths: string[] = [];
	let parseOptions = true;

	for (const argument of argv) {
		if (parseOptions && argument === '--') {
			parseOptions = false;
			continue;
		}

		if (parseOptions && argument.startsWith('-') && argument !== '-') {
			throw commandArgumentError('cat', `unsupported option: ${argument}`);
		}

		paths.push(argument);
	}

	return { paths };
};

const copyDescriptor = async (
	input: FileDescriptor,
	output: FileDescriptor,
	signal: AbortSignal
): Promise<void> => {
	while (true) {
		const next = await input.read(signal);
		if (next === null) return;
		await output.write(next, signal);
	}
};

const catCommand = {
	usage: 'cat [--] [FILE ...]',
	completion: {
		options: ['--'],
		operand: 'file'
	},
	schema: CatArgumentsSchema,
	normalize: normalizeCatArguments,
	run: async (context, arguments_): Promise<ProcessExit> => {
		const paths = arguments_.paths.length === 0 ? ['-'] : arguments_.paths;
		let failed = false;

		for (const path of paths) {
			const ownsInput = path !== '-';
			let input: FileDescriptor | undefined;

			try {
				input = ownsInput
					? await filesystem.open(context.cwd, path)
					: context.stdin;
				await copyDescriptor(input, context.stdout, context.signal);
			} catch (error: unknown) {
				failed = true;
				await writeText(
					context.stderr,
					`cat: ${errorMessage(error, `cannot read ${path}`)}\n`,
					context.signal
				);
			} finally {
				if (ownsInput && input !== undefined) await input.close();
			}
		}

		return { exitCode: asExitCode(failed ? 1 : 0), effects: [] };
	}
} satisfies CommandDefinition<typeof CatArgumentsSchema>;

const normalizeLsArguments = (argv: readonly string[]): unknown => {
	const options = {
		all: false,
		long: false,
		humanReadable: false,
		onePerLine: false,
		paths: [] as string[]
	};
	let parseOptions = true;

	for (const argument of argv) {
		if (parseOptions && argument === '--') {
			parseOptions = false;
			continue;
		}

		if (parseOptions && argument.startsWith('--')) {
			if (argument === '--all') options.all = true;
			else if (argument === '--long') options.long = true;
			else if (argument === '--human-readable') options.humanReadable = true;
			else if (argument === '--one-per-line') options.onePerLine = true;
			else throw commandArgumentError('ls', `unsupported option: ${argument}`);
			continue;
		}

		if (parseOptions && argument.startsWith('-') && argument !== '-') {
			for (const flag of argument.slice(1)) {
				if (flag === 'a') options.all = true;
				else if (flag === 'l') options.long = true;
				else if (flag === 'h') options.humanReadable = true;
				else if (flag === '1') options.onePerLine = true;
				else throw commandArgumentError('ls', `unsupported option: -${flag}`);
			}
			continue;
		}

		options.paths.push(argument);
	}

	return options;
};

const humanSize = (bytes: number): string => {
	const units = ['B', 'K', 'M', 'G'] as const;
	let value = bytes;
	let unit = 0;

	while (value >= 1_024 && unit < units.length - 1) {
		value /= 1_024;
		unit += 1;
	}

	return unit === 0 ? `${value}${units[unit]}` : `${value.toFixed(1)}${units[unit]}`;
};

const shellQuote = (value: string): string =>
	/^[A-Za-z0-9_./-]+$/.test(value)
		? value
		: value === ''
			? "''"
			: `'${value.replaceAll("'", `'\\''`)}'`;

const modifiedTime = (isoTimestamp: string): string => {
	const months = [
		'Jan',
		'Feb',
		'Mar',
		'Apr',
		'May',
		'Jun',
		'Jul',
		'Aug',
		'Sep',
		'Oct',
		'Nov',
		'Dec'
	] as const;
	const month = months[Number(isoTimestamp.slice(5, 7)) - 1] ?? '???';
	const day = String(Number(isoTimestamp.slice(8, 10))).padStart(2, ' ');
	return `${month} ${day} ${isoTimestamp.slice(11, 16)}`;
};

const directoryAction = (path: string, displayName: string): CommandAction => ({
	label: displayName,
	command: `cd ${shellQuote(path.endsWith('/') ? path : `${path}/`)}`,
	behavior: 'prefill'
});

const lsCommand = {
	usage: 'ls [-alh1] [--all] [--human-readable] [--one-per-line] [--] [PATH ...]',
	completion: {
		options: [
			'--',
			'--all',
			'--human-readable',
			'--long',
			'--one-per-line',
			'-1',
			'-a',
			'-h',
			'-l'
		],
		operand: 'path'
	},
	schema: LsArgumentsSchema,
	normalize: normalizeLsArguments,
	run: async (context, arguments_): Promise<ProcessExit> => {
		const paths = arguments_.paths.length === 0 ? ['.'] : arguments_.paths;
		let failed = false;

		for (const [pathIndex, path] of paths.entries()) {
			try {
				const target = await filesystem.stat(context.cwd, path);
				let entries =
					target.kind === 'directory'
						? [...(await filesystem.readDirectory(context.cwd, path))]
						: [target];

				if (paths.length > 1) {
					if (pathIndex > 0) await writeText(context.stdout, '\n', context.signal);
					await writeText(context.stdout, `${path}:\n`, context.signal);
				}

				if (target.kind === 'directory' && arguments_.all) {
					const parent = await filesystem.stat(context.cwd, `${path}/..`);
					entries.unshift(
						{ ...target, name: '.' },
						{ ...parent, name: '..' }
					);
				}

				entries = entries.filter(
					(entry) => arguments_.all || !entry.name.startsWith('.')
				);

				if (target.kind === 'directory' && arguments_.long) {
					const blocks = entries.reduce(
						(total, entry) => total + Math.max(1, Math.ceil(entry.size / 1_024)),
						0
					);
					await writeText(context.stdout, `total ${blocks}\n`, context.signal);
				}

				for (const [entryIndex, entry] of entries.entries()) {
					const displayName = `${entry.name}${entry.kind === 'directory' ? '/' : ''}`;
					const displaySize = arguments_.humanReadable
						? humanSize(entry.size)
						: String(entry.size);
					const separator =
						arguments_.long || arguments_.onePerLine || entryIndex === entries.length - 1
							? '\n'
							: '  ';
					const line = arguments_.long
						? `${displaySize.padStart(6)} ${modifiedTime(entry.modifiedAt)} ${displayName}${separator}`
						: `${displayName}${separator}`;
					const actionPath =
						entry.name === '.'
							? '.'
							: entry.name === '..'
								? '..'
								: target.kind === 'directory'
									? path === '.'
										? entry.name
										: `${path.replace(/\/$/, '')}/${entry.name}`
									: path;
					const actions =
						entry.kind === 'directory'
							? [directoryAction(actionPath, displayName)]
							: [];

					await writeText(context.stdout, line, context.signal, actions);
				}
			} catch (error: unknown) {
				failed = true;
				await writeText(
					context.stderr,
					`ls: ${errorMessage(error, `cannot access ${path}`)}\n`,
					context.signal
				);
			}
		}

		return { exitCode: asExitCode(failed ? 1 : 0), effects: [] };
	}
} satisfies CommandDefinition<typeof LsArgumentsSchema>;

const normalizeCdArguments = (argv: readonly string[]): unknown => {
	const paths = argv[0] === '--' ? argv.slice(1) : argv;
	if (paths.length > 1) throw commandArgumentError('cd', 'too many arguments');
	if (paths[0]?.startsWith('-') && paths[0] !== '-') {
		throw commandArgumentError('cd', `unsupported option: ${paths[0]}`);
	}
	return { path: paths[0] };
};

const cdCommand = {
	usage: 'cd [DIRECTORY]',
	completion: {
		options: ['--'],
		operand: 'directory'
	},
	schema: CdArgumentsSchema,
	normalize: normalizeCdArguments,
	run: async (context, arguments_): Promise<ProcessExit> => {
		const requested =
			arguments_.path === undefined
				? filesystem.initialDirectory
				: arguments_.path === '-'
					? context.oldCwd
					: arguments_.path;

		try {
			const target = await filesystem.stat(context.cwd, requested);
			if (target.kind !== 'directory') {
				await writeText(
					context.stderr,
					`cd: not a directory: ${arguments_.path ?? requested}\n`,
					context.signal
				);
				return { exitCode: asExitCode(1), effects: [] };
			}

			if (arguments_.path === '-') {
				await writeText(context.stdout, `${target.path}\n`, context.signal);
			}

			return {
				exitCode: asExitCode(0),
				effects: [{ kind: 'chdir', path: target.path }]
			};
		} catch (error: unknown) {
			await writeText(
				context.stderr,
				`cd: ${errorMessage(error, `cannot access ${String(requested)}`)}\n`,
				context.signal
			);
			return { exitCode: asExitCode(1), effects: [] };
		}
	}
} satisfies CommandDefinition<typeof CdArgumentsSchema>;

const normalizePwdArguments = (argv: readonly string[]): unknown => {
	const operands = argv[0] === '--' ? argv.slice(1) : argv;
	if (operands.length > 0) {
		throw commandArgumentError('pwd', `unsupported argument: ${operands[0]}`);
	}

	return {};
};

const pwdCommand = {
	usage: 'pwd',
	completion: {
		options: ['--'],
		operand: 'none'
	},
	schema: PwdArgumentsSchema,
	normalize: normalizePwdArguments,
	run: async (context): Promise<ProcessExit> => {
		await writeText(context.stdout, `${context.cwd}\n`, context.signal);
		return { exitCode: asExitCode(0), effects: [] };
	}
} satisfies CommandDefinition<typeof PwdArgumentsSchema>;

const normalizeSplitArguments = (argv: readonly string[]): unknown => {
	if (argv.length > 0) {
		throw commandArgumentError('split', `unsupported argument: ${argv[0]}`);
	}

	return {};
};

const splitCommand = {
	usage: 'split',
	completion: {
		options: [],
		operand: 'none'
	},
	schema: SplitArgumentsSchema,
	normalize: normalizeSplitArguments,
	run: async (): Promise<ProcessExit> => ({
		exitCode: asExitCode(0),
		effects: [{ kind: 'split' }]
	})
} satisfies CommandDefinition<typeof SplitArgumentsSchema>;

const readPositiveNumber = (
	command: string,
	flag: string,
	value: string | undefined
): number => {
	if (value === undefined) throw commandArgumentError(command, `${flag} requires a value`);
	const parsed = Number(value);
	if (!Number.isFinite(parsed) || parsed <= 0) {
		throw commandArgumentError(command, `${flag} requires a positive number`);
	}
	return parsed;
};

const normalizeCurlArguments = (argv: readonly string[]): unknown => {
	let head = false;
	let includeHeaders = false;
	let maxTimeMs = 5_000;
	let maxBytes = 65_536;
	const operands: string[] = [];
	let parseOptions = true;

	for (let index = 0; index < argv.length; index += 1) {
		const argument = argv[index];
		if (argument === undefined) continue;

		if (parseOptions && argument === '--') {
			parseOptions = false;
			continue;
		}

		if (parseOptions && (argument === '-I' || argument === '--head')) {
			head = true;
			continue;
		}

		if (parseOptions && (argument === '-i' || argument === '--include')) {
			includeHeaders = true;
			continue;
		}

		if (parseOptions && argument.startsWith('-') && !argument.startsWith('--')) {
			const flags = argument.slice(1);
			if ([...flags].every((flag) => flag === 'I' || flag === 'i')) {
				head ||= flags.includes('I');
				includeHeaders ||= flags.includes('i');
				continue;
			}
		}

		if (parseOptions && (argument === '--max-time' || argument.startsWith('--max-time='))) {
			const value = argument.includes('=') ? argument.slice(argument.indexOf('=') + 1) : argv[++index];
			maxTimeMs = Math.floor(readPositiveNumber('curl', '--max-time', value) * 1_000);
			continue;
		}

		if (
			parseOptions &&
			(argument === '--max-filesize' || argument.startsWith('--max-filesize='))
		) {
			const value = argument.includes('=') ? argument.slice(argument.indexOf('=') + 1) : argv[++index];
			maxBytes = Math.floor(readPositiveNumber('curl', '--max-filesize', value));
			continue;
		}

		if (parseOptions && argument.startsWith('-')) {
			throw commandArgumentError('curl', `unsupported option: ${argument}`);
		}

		operands.push(argument);
	}

	if (operands.length === 0) throw commandArgumentError('curl', 'URL is required');
	if (operands.length > 1) throw commandArgumentError('curl', 'only one URL is supported');

	return { url: operands[0], head, includeHeaders, maxTimeMs, maxBytes };
};

const isPrivateHostname = (hostname: string): boolean => {
	const normalized = hostname.toLowerCase().replace(/^\[|\]$/gu, '');
	if (
		normalized === 'localhost' ||
		normalized.endsWith('.localhost') ||
		normalized.endsWith('.local') ||
		normalized.endsWith('.internal') ||
		normalized === '::1' ||
		normalized.startsWith('fc') ||
		normalized.startsWith('fd') ||
		normalized.startsWith('fe80:')
	) {
		return true;
	}

	const octets = normalized.split('.').map(Number);
	if (octets.length !== 4 || octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) {
		return false;
	}

	const [first = 0, second = 0] = octets;
	return (
		first === 0 ||
		first === 10 ||
		first === 127 ||
		(first === 169 && second === 254) ||
		(first === 172 && second >= 16 && second <= 31) ||
		(first === 192 && second === 168) ||
		first >= 224
	);
};

const isTextContentType = (contentType: string): boolean => {
	const mediaType = contentType.split(';', 1)[0]?.trim().toLowerCase() ?? '';
	return (
		mediaType === '' ||
		mediaType.startsWith('text/') ||
		mediaType === 'application/json' ||
		mediaType.endsWith('+json') ||
		mediaType === 'application/xml' ||
		mediaType.endsWith('+xml') ||
		mediaType === 'application/javascript'
	);
};

export type HttpClient = Readonly<{
	request: (url: URL, init: RequestInit) => Promise<Response>;
}>;

export const httpClient: HttpClient = {
	request: async (url, init) => fetch(url, init)
};

const curlCommand = {
	usage: 'curl [-I] [-i] [--max-time SEC] [--max-filesize BYTES] URL',
	completion: {
		options: [
			'--',
			'--head',
			'--include',
			'--max-filesize',
			'--max-time',
			'-I',
			'-i'
		],
		operand: 'url'
	},
	schema: CurlArgumentsSchema,
	normalize: normalizeCurlArguments,
	run: async (context, arguments_): Promise<ProcessExit> => {
		let url: URL;

		try {
			url = new URL(arguments_.url);
		} catch {
			await writeText(context.stderr, 'curl: invalid URL\n', context.signal);
			return { exitCode: asExitCode(2), effects: [] };
		}

		if (
			url.protocol !== 'https:' ||
			url.username !== '' ||
			url.password !== '' ||
			isPrivateHostname(url.hostname)
		) {
			await writeText(
				context.stderr,
				'curl: only public HTTPS URLs without credentials are allowed\n',
				context.signal
			);
			return { exitCode: asExitCode(2), effects: [] };
		}

		const controller = new AbortController();
		let timedOut = false;
		const onAbort = () => controller.abort(context.signal.reason);
		context.signal.addEventListener('abort', onAbort, { once: true });
		const timeout = setTimeout(() => {
			timedOut = true;
			controller.abort('curl timeout');
		}, arguments_.maxTimeMs);

		try {
			const response = await httpClient.request(url, {
				method: arguments_.head ? 'HEAD' : 'GET',
				credentials: 'omit',
				cache: 'no-store',
				redirect: 'error',
				referrerPolicy: 'no-referrer',
				signal: controller.signal
			});

			if (arguments_.includeHeaders || arguments_.head) {
				const headers = [...response.headers]
					.map(([name, value]) => `${name}: ${value}`)
					.join('\n');
				const headerOutput = `HTTP ${response.status} ${response.statusText}\n${headers}\n\n`;
				await writeText(
					context.stdout,
					headerOutput.slice(0, 16_384),
					context.signal
				);
			}

			if (arguments_.head) return { exitCode: asExitCode(0), effects: [] };

			const contentType = response.headers.get('content-type') ?? '';
			if (!isTextContentType(contentType)) {
				await writeText(context.stderr, `curl: refusing binary content type ${contentType}\n`, context.signal);
				return { exitCode: asExitCode(1), effects: [] };
			}

			const declaredLength = Number(response.headers.get('content-length'));
			if (Number.isFinite(declaredLength) && declaredLength > arguments_.maxBytes) {
				await response.body?.cancel();
				await writeText(context.stderr, `curl: response exceeds ${arguments_.maxBytes} bytes\n`, context.signal);
				return { exitCode: asExitCode(63), effects: [] };
			}

			const reader = response.body?.getReader();
			if (reader === undefined) return { exitCode: asExitCode(0), effects: [] };

			let received = 0;
			while (true) {
				const next = await reader.read();
				if (next.done) break;
				received += next.value.byteLength;

				if (received > arguments_.maxBytes) {
					await reader.cancel();
					await writeText(context.stderr, `curl: response exceeds ${arguments_.maxBytes} bytes\n`, context.signal);
					return { exitCode: asExitCode(63), effects: [] };
				}

				await context.stdout.write({ bytes: next.value, actions: [] }, context.signal);
			}

			return { exitCode: asExitCode(0), effects: [] };
		} catch (error: unknown) {
			if (timedOut) {
				await writeText(context.stderr, 'curl: operation timed out\n', context.signal);
				return { exitCode: asExitCode(28), effects: [] };
			}

			if (context.signal.aborted) {
				return { exitCode: asExitCode(130), effects: [] };
			}

			await writeText(
				context.stderr,
				`curl: request failed (network or CORS): ${errorMessage(error, 'unknown error')}\n`,
				context.signal
			);
			return { exitCode: asExitCode(1), effects: [] };
		} finally {
			clearTimeout(timeout);
			context.signal.removeEventListener('abort', onAbort);
		}
	}
} satisfies CommandDefinition<typeof CurlArgumentsSchema>;

export type ShellState = {
	cwd: AbsolutePath;
	oldCwd: AbsolutePath;
	nextPid: number;
};

export const createShellState = (
	cwd: AbsolutePath = filesystem.initialDirectory
): ShellState => ({
	cwd,
	oldCwd: cwd,
	nextPid: 1
});

export const commands = {
	cat: catCommand,
	ls: lsCommand,
	cd: cdCommand,
	pwd: pwdCommand,
	curl: curlCommand,
	split: splitCommand
} as const;

export type CommandName = keyof typeof commands;

export const prepareCommand = (argv: readonly string[]): PreparedCommand => {
	const [name, ...rawArguments] = argv;
	if (name === undefined) throw commandArgumentError('shell', 'empty command');

	const command = commands[name as CommandName] as
		| CommandDefinition<z.ZodType>
		| undefined;
	if (command === undefined) {
		throw commandArgumentError(name, 'command not found');
	}

	const normalized = command.normalize(rawArguments);
	const arguments_ = command.schema.parse(normalized);

	return {
		name,
		argv,
		run: async (context) => command.run(context, arguments_)
	};
};

export const applyProcessEffects = (
	state: ShellState,
	effects: readonly ProcessExit['effects'][number][]
): void => {
	for (const effect of effects) {
		if (effect.kind === 'chdir') {
			state.oldCwd = state.cwd;
			state.cwd = effect.path;
		}
	}
};
