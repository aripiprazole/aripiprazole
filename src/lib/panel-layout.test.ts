import { describe, expect, test } from 'bun:test';

import {
	closePanel,
	hasNarrowPriority,
	movePanel,
	nextSplitAxis,
	panelIds,
	panelLeaf,
	splitPanel
} from './panel-layout';

describe('panel layout', () => {
	test('splits the selected leaf without changing existing panel identity', () => {
		const initial = panelLeaf('one');
		const horizontal = splitPanel(initial, 'one', 'two', 'horizontal');
		const vertical = splitPanel(horizontal, 'one', 'three', 'vertical');

		expect(horizontal).toEqual({
			kind: 'split',
			axis: 'horizontal',
			first: panelLeaf('one'),
			second: panelLeaf('two')
		});
		expect(vertical).toEqual({
			kind: 'split',
			axis: 'horizontal',
			first: {
				kind: 'split',
				axis: 'vertical',
				first: panelLeaf('one'),
				second: panelLeaf('three')
			},
			second: panelLeaf('two')
		});
		expect(panelIds(vertical)).toEqual(['one', 'three', 'two']);
	});

	test('alternates the next split axis', () => {
		expect(nextSplitAxis('horizontal')).toBe('vertical');
		expect(nextSplitAxis('vertical')).toBe('horizontal');
	});

	test('closes a panel and collapses its surrounding split', () => {
		const layout = splitPanel(
			splitPanel(panelLeaf('one'), 'one', 'two', 'horizontal'),
			'one',
			'three',
			'vertical'
		);

		expect(closePanel(layout, 'three')).toEqual({
			kind: 'split',
			axis: 'horizontal',
			first: panelLeaf('one'),
			second: panelLeaf('two')
		});
		expect(closePanel(panelLeaf('one'), 'one')).toBeNull();
	});

	test('moves a panel into the target slot and shifts intervening leaves', () => {
		const layout = splitPanel(
			splitPanel(panelLeaf('one'), 'one', 'two', 'horizontal'),
			'two',
			'three',
			'vertical'
		);

		expect(panelIds(movePanel(layout, 'one', 'three'))).toEqual([
			'two',
			'three',
			'one'
		]);
		expect(panelIds(movePanel(layout, 'three', 'one'))).toEqual([
			'three',
			'one',
			'two'
		]);
	});

	test('moves panel sizing, mode, priority, and label with its identity', () => {
		const content = panelLeaf('content');
		const profile = panelLeaf('profile', {
			sizing: 'intrinsic',
			mode: 'output-only',
			narrowPriority: 'first',
			label: 'profile terminal'
		});
		const layout = {
			kind: 'split' as const,
			axis: 'horizontal' as const,
			first: content,
			second: profile
		};
		const moved = movePanel(layout, 'profile', 'content');

		expect(panelIds(moved)).toEqual(['profile', 'content']);
		if (moved.kind !== 'split') throw new Error('expected a split layout');
		expect(moved.first).toBe(profile);
		expect(moved.second).toBe(content);
	});

	test('identifies the branch containing the narrow-priority panel', () => {
		const profile = panelLeaf('profile', { narrowPriority: 'first' });
		const layout = {
			kind: 'split' as const,
			axis: 'horizontal' as const,
			first: panelLeaf('content'),
			second: {
				kind: 'split' as const,
				axis: 'vertical' as const,
				first: profile,
				second: panelLeaf('socials')
			}
		};

		expect(hasNarrowPriority(layout)).toBe(true);
		expect(hasNarrowPriority(layout.first)).toBe(false);
		expect(hasNarrowPriority(layout.second)).toBe(true);
		expect(hasNarrowPriority(profile)).toBe(true);
	});

	test('leaves the tree untouched when a requested panel is absent', () => {
		const layout = panelLeaf('one');
		expect(splitPanel(layout, 'missing', 'two', 'horizontal')).toBe(layout);
		expect(closePanel(layout, 'missing')).toBe(layout);
		expect(movePanel(layout, 'missing', 'one')).toBe(layout);
	});
});
