import { PipelineSchema, type CommandStage } from './schemas';

export const shellParserLimits = {
	inputBytes: 4 * 1024,
	stages: 8,
	argumentsPerStage: 64,
	argumentBytes: 2 * 1024
} as const;

export type ParsedCommandStage = Readonly<CommandStage>;

export type ParsedPipeline = Readonly<{
	stages: readonly ParsedCommandStage[];
}>;

export type ShellParseErrorKind =
	| 'input-too-large'
	| 'argument-too-large'
	| 'too-many-stages'
	| 'too-many-arguments'
	| 'empty-stage'
	| 'unterminated-single-quote'
	| 'unterminated-double-quote'
	| 'unterminated-escape'
	| 'unsupported-syntax'
	| 'multiline-input'
	| 'nul-byte';

export type ShellParseError = Readonly<{
	name: 'ShellParseError';
	kind: ShellParseErrorKind;
	message: string;
	offset: number;
}>;

type Quote = 'single' | 'double' | null;

const encoder = new TextEncoder();

const shellParseErrorKinds = new Set<ShellParseErrorKind>([
	'input-too-large',
	'argument-too-large',
	'too-many-stages',
	'too-many-arguments',
	'empty-stage',
	'unterminated-single-quote',
	'unterminated-double-quote',
	'unterminated-escape',
	'unsupported-syntax',
	'multiline-input',
	'nul-byte'
]);

const byteLength = (value: string): number => encoder.encode(value).byteLength;

const createShellParseError = (
	kind: ShellParseErrorKind,
	message: string,
	offset: number
): ShellParseError => ({
	name: 'ShellParseError',
	kind,
	message,
	offset
});

export const isShellParseError = (value: unknown): value is ShellParseError => {
	if (typeof value !== 'object' || value === null) {
		return false;
	}

	const candidate = value as Partial<ShellParseError>;

	return (
		candidate.name === 'ShellParseError' &&
		typeof candidate.kind === 'string' &&
		shellParseErrorKinds.has(candidate.kind as ShellParseErrorKind) &&
		typeof candidate.message === 'string' &&
		typeof candidate.offset === 'number'
	);
};

const unsupportedSyntax = {
	'<': 'redirection',
	'>': 'redirection',
	';': 'command lists',
	'&': 'command operators',
	'$': 'parameter and command expansion',
	'`': 'command substitution',
	'*': 'pathname expansion',
	'?': 'pathname expansion',
	'[': 'pathname expansion',
	']': 'pathname expansion',
	'(': 'subshells',
	')': 'subshells',
	'{': 'brace expansion',
	'}': 'brace expansion'
} as const satisfies Readonly<Record<string, string>>;

const unsupportedDescription = (character: string): string | undefined =>
	unsupportedSyntax[character as keyof typeof unsupportedSyntax];

const isSeparator = (character: string): boolean =>
	character === ' ' || character === '\t';

export const parsePipeline = (source: string): ParsedPipeline => {
	const sourceBytes = byteLength(source);

	if (sourceBytes > shellParserLimits.inputBytes) {
		throw createShellParseError(
			'input-too-large',
			`command line exceeds ${shellParserLimits.inputBytes} bytes`,
			source.length
		);
	}

	const newlineOffset = source.search(/[\r\n]/u);

	if (newlineOffset !== -1) {
		throw createShellParseError(
			'multiline-input',
			'multiline commands are not supported',
			newlineOffset
		);
	}

	const nulOffset = source.indexOf('\0');

	if (nulOffset !== -1) {
		throw createShellParseError('nul-byte', 'NUL bytes are not supported', nulOffset);
	}

	const stages: string[][] = [[]];
	let current = '';
	let currentStarted = false;
	let quote: Quote = null;
	let quoteOffset = -1;

	const finishArgument = (offset: number): void => {
		if (!currentStarted) {
			return;
		}

		if (byteLength(current) > shellParserLimits.argumentBytes) {
			throw createShellParseError(
				'argument-too-large',
				`argument exceeds ${shellParserLimits.argumentBytes} bytes`,
				offset
			);
		}

		const stage = stages.at(-1);

		if (stage === undefined) {
			throw new Error('parser invariant violated: missing command stage');
		}

		if (stage.length >= shellParserLimits.argumentsPerStage) {
			throw createShellParseError(
				'too-many-arguments',
				`command stage exceeds ${shellParserLimits.argumentsPerStage} arguments`,
				offset
			);
		}

		stage.push(current);
		current = '';
		currentStarted = false;
	};

	for (let offset = 0; offset < source.length; offset += 1) {
		const character = source[offset];

		if (character === undefined) {
			throw new Error('parser invariant violated: missing source character');
		}

		if (quote === 'single') {
			if (character === "'") {
				quote = null;
			} else {
				current += character;
			}

			continue;
		}

		if (quote === 'double') {
			if (character === '"') {
				quote = null;
				continue;
			}

			if (character === '\\') {
				const escaped = source[offset + 1];

				if (escaped === undefined) {
					throw createShellParseError(
						'unterminated-escape',
						'backslash must escape another character',
						offset
					);
				}

				current += escaped;
				offset += 1;
				continue;
			}

			if (character === '$' || character === '`') {
				throw createShellParseError(
					'unsupported-syntax',
					'command and parameter expansion are not supported',
					offset
				);
			}

			current += character;
			continue;
		}

		if (isSeparator(character)) {
			finishArgument(offset);
			continue;
		}

		if (character === '\\') {
			const escaped = source[offset + 1];

			if (escaped === undefined) {
				throw createShellParseError(
					'unterminated-escape',
					'backslash must escape another character',
					offset
				);
			}

			currentStarted = true;
			current += escaped;
			offset += 1;
			continue;
		}

		if (character === "'" || character === '"') {
			currentStarted = true;
			quote = character === "'" ? 'single' : 'double';
			quoteOffset = offset;
			continue;
		}

		if (character === '|') {
			if (source[offset + 1] === '|') {
				throw createShellParseError(
					'unsupported-syntax',
					'logical OR is not supported',
					offset
				);
			}

			finishArgument(offset);

			const stage = stages.at(-1);

			if (stage === undefined || stage.length === 0) {
				throw createShellParseError(
					'empty-stage',
					'pipeline stages cannot be empty',
					offset
				);
			}

			if (stages.length >= shellParserLimits.stages) {
				throw createShellParseError(
					'too-many-stages',
					`pipeline exceeds ${shellParserLimits.stages} stages`,
					offset
				);
			}

			stages.push([]);
			continue;
		}

		const description = unsupportedDescription(character);

		if (description !== undefined) {
			throw createShellParseError(
				'unsupported-syntax',
				`${description} are not supported`,
				offset
			);
		}

		currentStarted = true;
		current += character;
	}

	if (quote !== null) {
		throw createShellParseError(
			quote === 'single'
				? 'unterminated-single-quote'
				: 'unterminated-double-quote',
			`unterminated ${quote}-quoted string`,
			quoteOffset
		);
	}

	finishArgument(source.length);

	const finalStage = stages.at(-1);

	if (finalStage === undefined || finalStage.length === 0) {
		throw createShellParseError(
			'empty-stage',
			'pipeline stages cannot be empty',
			source.length
		);
	}

	return PipelineSchema.parse({
		stages: stages.map((argv) => ({ argv }))
	});
};
