export type PanelId = string;
export type SplitAxis = 'horizontal' | 'vertical';
export type PanelSizing = 'fill' | 'intrinsic';
export type PanelMode = 'interactive' | 'output-only';

export type PanelLeafOptions = Readonly<{
	sizing?: PanelSizing;
	mode?: PanelMode;
	narrowPriority?: 'first';
	label?: string;
}>;

export type PanelLeaf = Readonly<{
	kind: 'panel';
	id: PanelId;
}> &
	PanelLeafOptions;

export type PanelLayout =
	| PanelLeaf
	| Readonly<{
			kind: 'split';
			axis: SplitAxis;
			ratio?: '3:1';
			narrowFlow?: 'wrap';
			first: PanelLayout;
			second: PanelLayout;
	  }>;

export const panelLeaf = (
	id: PanelId,
	options: PanelLeafOptions = {}
): PanelLeaf => ({ kind: 'panel', id, ...options });

export const panelIds = (layout: PanelLayout): readonly PanelId[] => {
	if (layout.kind === 'panel') return [layout.id];
	return [...panelIds(layout.first), ...panelIds(layout.second)];
};

export const splitPanel = (
	layout: PanelLayout,
	targetId: PanelId,
	newId: PanelId,
	axis: SplitAxis
): PanelLayout => {
	if (layout.kind === 'panel') {
		if (layout.id !== targetId) return layout;
		return {
			kind: 'split',
			axis,
			first: layout,
			second: panelLeaf(newId)
		};
	}

	const first = splitPanel(layout.first, targetId, newId, axis);
	if (first !== layout.first) return { ...layout, first };

	const second = splitPanel(layout.second, targetId, newId, axis);
	return second === layout.second ? layout : { ...layout, second };
};

export const closePanel = (
	layout: PanelLayout,
	targetId: PanelId
): PanelLayout | null => {
	if (layout.kind === 'panel') return layout.id === targetId ? null : layout;

	const first = closePanel(layout.first, targetId);
	if (first === null) return layout.second;
	if (first !== layout.first) return { ...layout, first };

	const second = closePanel(layout.second, targetId);
	if (second === null) return layout.first;
	return second === layout.second ? layout : { ...layout, second };
};

const panelLeaves = (layout: PanelLayout): readonly PanelLeaf[] => {
	if (layout.kind === 'panel') return [layout];
	return [...panelLeaves(layout.first), ...panelLeaves(layout.second)];
};

const replacePanelLeaves = (
	layout: PanelLayout,
	leaves: readonly PanelLeaf[],
	position: { value: number }
): PanelLayout => {
	if (layout.kind === 'panel') {
		const leaf = leaves[position.value++];
		return leaf ?? layout;
	}

	const first = replacePanelLeaves(layout.first, leaves, position);
	const second = replacePanelLeaves(layout.second, leaves, position);
	return first === layout.first && second === layout.second
		? layout
		: { ...layout, first, second };
};

export const movePanel = (
	layout: PanelLayout,
	sourceId: PanelId,
	targetId: PanelId
): PanelLayout => {
	const leaves = [...panelLeaves(layout)];
	const sourceIndex = leaves.findIndex((leaf) => leaf.id === sourceId);
	const targetIndex = leaves.findIndex((leaf) => leaf.id === targetId);
	if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return layout;

	const [source] = leaves.splice(sourceIndex, 1);
	if (source === undefined) return layout;
	leaves.splice(Math.min(targetIndex, leaves.length), 0, source);
	return replacePanelLeaves(layout, leaves, { value: 0 });
};

export const prioritizePanel = (
	layout: PanelLayout,
	targetId: PanelId
): PanelLayout => {
	const firstId = panelIds(layout)[0];
	return firstId === undefined || firstId === targetId
		? layout
		: movePanel(layout, targetId, firstId);
};

export const prioritizeNarrowPanel = (layout: PanelLayout): PanelLayout => {
	if (layout.kind === 'panel') return layout;

	const firstHasPriority = panelLeaves(layout.first).some(
		(leaf) => leaf.narrowPriority === 'first'
	);
	if (firstHasPriority) {
		const first = prioritizeNarrowPanel(layout.first);
		return first === layout.first ? layout : { ...layout, first };
	}

	const secondHasPriority = panelLeaves(layout.second).some(
		(leaf) => leaf.narrowPriority === 'first'
	);
	if (!secondHasPriority) return layout;

	return {
		...layout,
		first: prioritizeNarrowPanel(layout.second),
		second: layout.first
	};
};

export const nextSplitAxis = (axis: SplitAxis): SplitAxis =>
	axis === 'horizontal' ? 'vertical' : 'horizontal';
