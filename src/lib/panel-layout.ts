export type PanelId = string;
export type SplitAxis = 'horizontal' | 'vertical';

export type PanelLayout =
	| Readonly<{
			kind: 'panel';
			id: PanelId;
	  }>
	| Readonly<{
			kind: 'split';
			axis: SplitAxis;
			first: PanelLayout;
			second: PanelLayout;
	  }>;

export const panelLeaf = (id: PanelId): PanelLayout => ({ kind: 'panel', id });

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

const replacePanelIds = (
	layout: PanelLayout,
	ids: readonly PanelId[],
	position: { value: number }
): PanelLayout => {
	if (layout.kind === 'panel') {
		const id = ids[position.value++];
		return id === undefined || id === layout.id ? layout : panelLeaf(id);
	}

	const first = replacePanelIds(layout.first, ids, position);
	const second = replacePanelIds(layout.second, ids, position);
	return first === layout.first && second === layout.second
		? layout
		: { ...layout, first, second };
};

export const movePanel = (
	layout: PanelLayout,
	sourceId: PanelId,
	targetId: PanelId
): PanelLayout => {
	const ids = [...panelIds(layout)];
	const sourceIndex = ids.indexOf(sourceId);
	const targetIndex = ids.indexOf(targetId);
	if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return layout;

	const [source] = ids.splice(sourceIndex, 1);
	if (source === undefined) return layout;
	ids.splice(Math.min(targetIndex, ids.length), 0, source);
	return replacePanelIds(layout, ids, { value: 0 });
};

export const nextSplitAxis = (axis: SplitAxis): SplitAxis =>
	axis === 'horizontal' ? 'vertical' : 'horizontal';
