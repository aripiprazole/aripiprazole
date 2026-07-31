import { describe, expect, test } from 'bun:test';

import {
	isShellParseError,
	parsePipeline,
	shellParserLimits,
	type ShellParseError
} from './parser';

const parseError = (source: string): ShellParseError => {
	try {
		parsePipeline(source);
	} catch (error: unknown) {
		if (isShellParseError(error)) {
			return error;
		}

		throw error;
	}

	throw new Error(`expected ${JSON.stringify(source)} to fail parsing`);
};

describe('parsePipeline', () => {
	test('parses words and shell whitespace', () => {
		expect(parsePipeline('  ls\t-la   projects  ')).toEqual({
			stages: [{ argv: ['ls', '-la', 'projects'] }]
		});
	});

	test('parses adjacent pipeline delimiters', () => {
		expect(parsePipeline('cat README.md|cat|ls -1')).toEqual({
			stages: [
				{ argv: ['cat', 'README.md'] },
				{ argv: ['cat'] },
				{ argv: ['ls', '-1'] }
			]
		});
	});

	test('parses quoted, concatenated, and empty arguments', () => {
		expect(parsePipeline(`cat '' "" pre"mid"'post' "two words" 'three words'`)).toEqual({
			stages: [
				{
					argv: ['cat', '', '', 'premidpost', 'two words', 'three words']
				}
			]
		});
	});

	test('supports backslash escaping outside and inside double quotes', () => {
		expect(parsePipeline(String.raw`cat one\ two \| \$ "say \"hello\""`)).toEqual({
			stages: [{ argv: ['cat', 'one two', '|', '$', 'say "hello"'] }]
		});
	});

	test('keeps metacharacters literal when quoted or escaped', () => {
		expect(parsePipeline(String.raw`cat '>$*?[{}]();&|' "literal > value" \>`)).toEqual({
			stages: [{ argv: ['cat', '>$*?[{}]();&|', 'literal > value', '>'] }]
		});
	});

	test.each([
		['', 'empty-stage'],
		['   \t', 'empty-stage'],
		['| cat', 'empty-stage'],
		['cat |', 'empty-stage'],
		['cat | | ls', 'empty-stage'],
		['cat || ls', 'unsupported-syntax']
	] as const)('rejects an invalid pipeline: %p', (source, kind) => {
		expect(parseError(source).kind).toBe(kind);
	});

	test.each([
		[`cat 'open`, 'unterminated-single-quote'],
		['cat "open', 'unterminated-double-quote'],
		['cat trailing\\', 'unterminated-escape'],
		['cat "trailing\\', 'unterminated-escape']
	] as const)('rejects incomplete quoting or escaping: %p', (source, kind) => {
		expect(parseError(source).kind).toBe(kind);
	});

	test.each(['cat\nls', 'cat\rls', "cat 'one\ntwo'", 'cat one\\\ntwo'])(
		'rejects multiline input: %p',
		(source) => {
			expect(parseError(source).kind).toBe('multiline-input');
		}
	);

	test('rejects NUL even when quoted', () => {
		expect(parseError("cat 'one\0two'").kind).toBe('nul-byte');
	});

	test.each([
		'cat > output',
		'cat < input',
		'cat; ls',
		'cat && ls',
		'cat &',
		'cat $HOME',
		'cat "${HOME}"',
		'cat `pwd`',
		'cat *',
		'cat file?.txt',
		'cat [ab]',
		'(cat file)',
		'cat {one,two}'
	])('rejects unsupported shell syntax: %p', (source) => {
		expect(parseError(source).kind).toBe('unsupported-syntax');
	});

	test('allows exactly eight pipeline stages', () => {
		const source = Array.from({ length: shellParserLimits.stages }, () => 'cat').join('|');

		expect(parsePipeline(source).stages).toHaveLength(shellParserLimits.stages);
	});

	test('rejects a ninth pipeline stage', () => {
		const source = Array.from({ length: shellParserLimits.stages + 1 }, () => 'cat').join('|');

		expect(parseError(source).kind).toBe('too-many-stages');
	});

	test('allows exactly sixty-four arguments in a stage', () => {
		const source = Array.from(
			{ length: shellParserLimits.argumentsPerStage },
			(_, index) => `a${index}`
		).join(' ');

		expect(parsePipeline(source).stages[0]?.argv).toHaveLength(
			shellParserLimits.argumentsPerStage
		);
	});

	test('rejects a sixty-fifth argument', () => {
		const source = Array.from(
			{ length: shellParserLimits.argumentsPerStage + 1 },
			() => 'a'
		).join(' ');

		expect(parseError(source).kind).toBe('too-many-arguments');
	});

	test('measures the per-argument limit in UTF-8 bytes', () => {
		const exact = 'é'.repeat(shellParserLimits.argumentBytes / 2);
		const oversized = `${exact}é`;

		expect(parsePipeline(exact).stages[0]?.argv).toEqual([exact]);
		expect(parseError(oversized).kind).toBe('argument-too-large');
	});

	test('rejects input over four KiB before parsing arguments', () => {
		const source = 'é'.repeat(shellParserLimits.inputBytes / 2 + 1);

		expect(parseError(source).kind).toBe('input-too-large');
	});

	test('allows an input exactly four KiB long', () => {
		const first = 'a'.repeat(shellParserLimits.argumentBytes - 1);
		const second = 'b'.repeat(shellParserLimits.argumentBytes);
		const source = `${first} ${second}`;

		expect(new TextEncoder().encode(source)).toHaveLength(shellParserLimits.inputBytes);
		expect(parsePipeline(source).stages[0]?.argv).toEqual([first, second]);
	});
});
