import {
	commands,
	type CommandCompletionOperand,
	type CommandName
} from './commands';
import { filesystem } from './filesystem';
import type { AbsolutePath } from './types';

export type ShellTokenKind =
	| 'plain'
	| 'command'
	| 'argument'
	| 'option'
	| 'string'
	| 'pipe'
	| 'invalid';

export type ShellToken = Readonly<{
	kind: ShellTokenKind;
	start: number;
	end: number;
	text: string;
}>;

export type ShellCompletionKind =
	| 'command'
	| 'option'
	| 'file'
	| 'directory';

export type ShellCompletionCandidate = Readonly<{
	kind: ShellCompletionKind;
	label: string;
	draft: string;
	cursor: number;
}>;

export type CompletionDirection = 1 | -1;

type ShellWord = Readonly<{
	start: number;
	end: number;
	value: string;
	raw: string;
	stage: number;
	index: number;
	hasQuotesOrEscapes: boolean;
}>;

type TokenPiece = Readonly<{
	kind: 'word' | 'string' | 'invalid';
	start: number;
	end: number;
}>;

type ShellScan = Readonly<{
	tokens: readonly ShellToken[];
	words: readonly ShellWord[];
}>;

const commandNames = (Object.keys(commands) as CommandName[]).sort();
const unsupportedUnquotedSyntax = new Set([
	'<',
	'>',
	';',
	'&',
	'$',
	'`',
	'*',
	'?',
	'[',
	']',
	'(',
	')',
	'{',
	'}'
]);

const isSeparator = (character: string): boolean =>
	character === ' ' || character === '\t';

const token = (
	source: string,
	kind: ShellTokenKind,
	start: number,
	end: number
): ShellToken => ({
	kind,
	start,
	end,
	text: source.slice(start, end)
});

const commandKind = (value: string): ShellTokenKind =>
	value.length > 0 && commandNames.some((name) => name.startsWith(value))
		? 'command'
		: 'invalid';

const scanShellInput = (source: string): ShellScan => {
	const tokens: ShellToken[] = [];
	const words: ShellWord[] = [];
	let offset = 0;
	let stage = 0;
	let wordIndex = 0;

	while (offset < source.length) {
		const character = source[offset];
		if (character === undefined) break;

		if (isSeparator(character)) {
			const start = offset;
			while (offset < source.length && isSeparator(source[offset] ?? '')) offset += 1;
			tokens.push(token(source, 'plain', start, offset));
			continue;
		}

		if (character === '|') {
			const repeated = source[offset + 1] === '|';
			const end = offset + (repeated ? 2 : 1);
			tokens.push(token(source, repeated ? 'invalid' : 'pipe', offset, end));
			offset = end;
			if (!repeated) {
				stage += 1;
				wordIndex = 0;
			}
			continue;
		}

		const wordStart = offset;
		const pieces: TokenPiece[] = [];
		let value = '';
		let hasQuotesOrEscapes = false;

		while (offset < source.length) {
			const current = source[offset];
			if (current === undefined || isSeparator(current) || current === '|') break;

			if (current === '\\') {
				hasQuotesOrEscapes = true;
				const escaped = source[offset + 1];
				if (escaped === undefined) {
					pieces.push({ kind: 'invalid', start: offset, end: offset + 1 });
					offset += 1;
					continue;
				}

				pieces.push({ kind: 'word', start: offset, end: offset + 2 });
				value += escaped;
				offset += 2;
				continue;
			}

			if (current === "'") {
				hasQuotesOrEscapes = true;
				const start = offset;
				offset += 1;
				while (offset < source.length && source[offset] !== "'") {
					value += source[offset] ?? '';
					offset += 1;
				}
				if (source[offset] === "'") offset += 1;
				pieces.push({ kind: 'string', start, end: offset });
				continue;
			}

			if (current === '"') {
				hasQuotesOrEscapes = true;
				let stringStart = offset;
				offset += 1;

				while (offset < source.length) {
					const quoted = source[offset];
					if (quoted === undefined) break;

					if (quoted === '"') {
						offset += 1;
						break;
					}

					if (quoted === '\\') {
						const escaped = source[offset + 1];
						if (escaped === undefined) {
							offset += 1;
							break;
						}
						value += escaped;
						offset += 2;
						continue;
					}

					if (quoted === '$' || quoted === '`') {
						if (stringStart < offset) {
							pieces.push({ kind: 'string', start: stringStart, end: offset });
						}
						pieces.push({ kind: 'invalid', start: offset, end: offset + 1 });
						value += quoted;
						offset += 1;
						stringStart = offset;
						continue;
					}

					value += quoted;
					offset += 1;
				}

				if (stringStart < offset) {
					pieces.push({ kind: 'string', start: stringStart, end: offset });
				}
				continue;
			}

			if (unsupportedUnquotedSyntax.has(current)) {
				pieces.push({ kind: 'invalid', start: offset, end: offset + 1 });
				value += current;
				offset += 1;
				continue;
			}

			const start = offset;
			while (offset < source.length) {
				const plain = source[offset];
				if (
					plain === undefined ||
					isSeparator(plain) ||
					plain === '|' ||
					plain === '\\' ||
					plain === "'" ||
					plain === '"' ||
					unsupportedUnquotedSyntax.has(plain)
				) {
					break;
				}
				value += plain;
				offset += 1;
			}
			pieces.push({ kind: 'word', start, end: offset });
		}

		const wordEnd = offset;
		const raw = source.slice(wordStart, wordEnd);
		const defaultKind =
			wordIndex === 0
				? commandKind(value)
				: raw.startsWith('-')
					? 'option'
					: 'argument';

		for (const piece of pieces) {
			tokens.push(
				token(
					source,
					piece.kind === 'word' ? defaultKind : piece.kind,
					piece.start,
					piece.end
				)
			);
		}

		words.push({
			start: wordStart,
			end: wordEnd,
			value,
			raw,
			stage,
			index: wordIndex,
			hasQuotesOrEscapes
		});
		wordIndex += 1;
	}

	return { tokens, words };
};

export const analyzeShellInput = (source: string): readonly ShellToken[] =>
	scanShellInput(source).tokens;

export const cycleCompletionIndex = (
	current: number | null,
	length: number,
	direction: CompletionDirection
): number | null => {
	if (length === 0) return null;
	if (current === null) return direction === 1 ? 0 : length - 1;
	return (current + direction + length) % length;
};

const completionDraft = (
	source: string,
	start: number,
	end: number,
	replacement: string,
	appendSpace: boolean
): Readonly<{ draft: string; cursor: number }> => {
	const suffix = source.slice(end);
	const separator = appendSpace && suffix.length === 0 ? ' ' : '';
	const inserted = `${replacement}${separator}`;
	return {
		draft: `${source.slice(0, start)}${inserted}${suffix}`,
		cursor: start + inserted.length
	};
};

const candidate = (
	source: string,
	start: number,
	end: number,
	kind: ShellCompletionKind,
	label: string,
	replacement: string,
	appendSpace: boolean
): ShellCompletionCandidate => ({
	kind,
	label,
	...completionDraft(source, start, end, replacement, appendSpace)
});

const commandCandidates = (
	source: string,
	start: number,
	end: number,
	prefix: string
): readonly ShellCompletionCandidate[] =>
	commandNames
		.filter((name) => name.startsWith(prefix))
		.map((name) => candidate(source, start, end, 'command', name, name, true));

const optionCandidates = (
	source: string,
	start: number,
	end: number,
	prefix: string,
	options: readonly string[]
): readonly ShellCompletionCandidate[] =>
	options
		.filter((option) => option.startsWith(prefix))
		.map((option) => candidate(source, start, end, 'option', option, option, true));

const pathKindAllowed = (
	operand: CommandCompletionOperand,
	kind: 'file' | 'directory'
): boolean =>
	operand === 'path' ||
	(operand === 'file' && kind === 'file') ||
	(operand === 'directory' && kind === 'directory');

const pathCandidates = async (
	source: string,
	start: number,
	end: number,
	prefix: string,
	cwd: AbsolutePath,
	operand: CommandCompletionOperand
): Promise<readonly ShellCompletionCandidate[]> => {
	const separator = prefix.lastIndexOf('/');
	const directory =
		separator < 0 ? '.' : separator === 0 ? '/' : prefix.slice(0, separator);
	const displayPrefix = separator < 0 ? '' : prefix.slice(0, separator + 1);
	const namePrefix = separator < 0 ? prefix : prefix.slice(separator + 1);

	try {
		const entries = await filesystem.readDirectory(cwd, directory);
		return entries
			.filter(
				(entry) =>
					entry.name.startsWith(namePrefix) &&
					pathKindAllowed(operand, entry.kind)
			)
			.map((entry) => {
				const label = `${displayPrefix}${entry.name}${entry.kind === 'directory' ? '/' : ''}`;
				return candidate(
					source,
					start,
					end,
					entry.kind,
					label,
					label,
					entry.kind === 'file'
				);
			});
	} catch {
		return [];
	}
};

export const completeShellInput = async (
	source: string,
	cursor: number,
	cwd: AbsolutePath
): Promise<readonly ShellCompletionCandidate[]> => {
	const safeCursor = Math.max(0, Math.min(cursor, source.length));
	const scan = scanShellInput(source);
	const stage = scan.tokens.filter(
		(candidateToken) =>
			candidateToken.kind === 'pipe' && candidateToken.end <= safeCursor
	).length;
	const stageWords = scan.words.filter((word) => word.stage === stage);
	const activeWord = stageWords.find(
		(word) => word.start <= safeCursor && safeCursor <= word.end
	);

	if (activeWord?.hasQuotesOrEscapes) return [];

	const start = activeWord?.start ?? safeCursor;
	const end = activeWord?.end ?? safeCursor;
	const prefix = source.slice(start, safeCursor);
	const activeIndex =
		activeWord?.index ?? stageWords.filter((word) => word.end <= safeCursor).length;

	if (activeIndex === 0) {
		return commandCandidates(source, start, end, prefix);
	}

	const commandWord = stageWords.find((word) => word.index === 0);
	const command = commands[commandWord?.value as CommandName] as
		| (typeof commands)[CommandName]
		| undefined;
	if (command === undefined) return [];

	const priorArguments = stageWords.filter(
		(word) => word.index > 0 && word.end <= start
	);
	const optionsEnabled = !priorArguments.some((word) => word.value === '--');
	const suggestions: ShellCompletionCandidate[] = [];

	if (optionsEnabled && (prefix.length === 0 || prefix.startsWith('-'))) {
		suggestions.push(
			...optionCandidates(
				source,
				start,
				end,
				prefix,
				command.completion.options
			)
		);
	}

	if (
		command.completion.operand === 'file' ||
		command.completion.operand === 'directory' ||
		command.completion.operand === 'path'
	) {
		if (optionsEnabled ? !prefix.startsWith('-') : true) {
			suggestions.push(
				...(await pathCandidates(
					source,
					start,
					end,
					prefix,
					cwd,
					command.completion.operand
				))
			);
		}
	}

	return suggestions.sort((left, right) => left.label.localeCompare(right.label));
};
