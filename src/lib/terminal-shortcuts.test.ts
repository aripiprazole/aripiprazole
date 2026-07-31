import { describe, expect, test } from 'bun:test';

import { terminalShortcutAction } from './terminal-shortcuts';

describe('terminal shortcuts', () => {
	test('interrupts an interactive terminal with ctrl+c', () => {
		expect(
			terminalShortcutAction({
				key: 'c',
				ctrlKey: true,
				repeat: false,
				copying: false,
				mode: 'interactive',
				canClose: true
			})
		).toBe('interrupt');
	});

	test('finishes a closable output-only terminal with ctrl+c', () => {
		expect(
			terminalShortcutAction({
				key: 'C',
				ctrlKey: true,
				repeat: false,
				copying: false,
				mode: 'output-only',
				canClose: true
			})
		).toBe('finish');
	});

	test('leaves ctrl+c alone while copying or when the last panel cannot close', () => {
		for (const input of [
			{
				key: 'c',
				ctrlKey: true,
				repeat: false,
				copying: true,
				mode: 'output-only' as const,
				canClose: true
			},
			{
				key: 'c',
				ctrlKey: true,
				repeat: false,
				copying: false,
				mode: 'output-only' as const,
				canClose: false
			}
		]) {
			expect(terminalShortcutAction(input)).toBeNull();
		}
	});

	test('ignores repeated ctrl+c keydowns', () => {
		for (const mode of ['interactive', 'output-only'] as const) {
			expect(
				terminalShortcutAction({
					key: 'c',
					ctrlKey: true,
					repeat: true,
					copying: false,
					mode,
					canClose: true
				})
			).toBeNull();
		}
	});

	test('keeps ctrl+l scoped to interactive terminals', () => {
		expect(
			terminalShortcutAction({
				key: 'l',
				ctrlKey: true,
				repeat: false,
				copying: false,
				mode: 'interactive',
				canClose: true
			})
		).toBe('clear');
		expect(
			terminalShortcutAction({
				key: 'l',
				ctrlKey: true,
				repeat: false,
				copying: false,
				mode: 'output-only',
				canClose: true
			})
		).toBeNull();
	});

	test('ignores unrelated keys and keys without control', () => {
		for (const input of [
			{
				key: 'x',
				ctrlKey: true,
				repeat: false,
				copying: false,
				mode: 'interactive' as const,
				canClose: true
			},
			{
				key: 'c',
				ctrlKey: false,
				repeat: false,
				copying: false,
				mode: 'interactive' as const,
				canClose: true
			}
		]) {
			expect(terminalShortcutAction(input)).toBeNull();
		}
	});
});
