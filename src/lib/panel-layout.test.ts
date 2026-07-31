import { describe, expect, test } from 'bun:test';

import {
	closePanel,
	movePanel,
	nextSplitAxis,
	panelIds,
	panelLeaf,
	prioritizeNarrowPanel,
	prioritizePanel,
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

	test('prioritizes the profile for narrow rendering without changing the source layout', () => {
		const layout = {
			kind: 'split' as const,
			axis: 'horizontal' as const,
			first: panelLeaf('content'),
			second: panelLeaf('profile', { narrowPriority: 'first' })
		};

		expect(panelIds(prioritizeNarrowPanel(layout))).toEqual([
			'profile',
			'content'
		]);
		expect(panelIds(layout)).toEqual(['content', 'profile']);
		expect(prioritizeNarrowPanel(layout).kind).toBe('split');
		expect(prioritizeNarrowPanel(panelLeaf('content'))).toEqual(
			panelLeaf('content')
		);
		expect(prioritizePanel(layout, 'missing')).toBe(layout);
	});

	test('moves the profile branch first while keeping its nested socials panel alongside it', () => {
		const profileGroup = {
			kind: 'split' as const,
			axis: 'vertical' as const,
			first: panelLeaf('profile', { narrowPriority: 'first' }),
			second: panelLeaf('socials')
		};
		const layout = {
			kind: 'split' as const,
			axis: 'horizontal' as const,
			first: panelLeaf('content'),
			second: profileGroup
		};
		const narrow = prioritizeNarrowPanel(layout);

		expect(panelIds(narrow)).toEqual(['profile', 'socials', 'content']);
		if (narrow.kind !== 'split') throw new Error('expected a split layout');
		expect(narrow.first).toBe(profileGroup);
		expect(panelIds(layout)).toEqual(['content', 'profile', 'socials']);
	});

	test('leaves the tree untouched when a requested panel is absent', () => {
		const layout = panelLeaf('one');
		expect(splitPanel(layout, 'missing', 'two', 'horizontal')).toBe(layout);
		expect(closePanel(layout, 'missing')).toBe(layout);
		expect(movePanel(layout, 'missing', 'one')).toBe(layout);
	});
});
