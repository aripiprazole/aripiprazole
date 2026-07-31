<script lang="ts">
	import PanelLayout from '$lib/PanelLayout.svelte';
	import TerminalPanel from '$lib/TerminalPanel.svelte';
	import type { PanelId, PanelLayout as Layout } from '$lib/panel-layout';
	import type { TerminalController } from '$lib/terminal.svelte';

	type Props = Readonly<{
		node: Layout;
		controllers: ReadonlyMap<PanelId, TerminalController>;
		panelCount: number;
		activePanelId: PanelId;
		draggingPanelId: PanelId | null;
		dropTargetPanelId: PanelId | null;
		onActivate: (id: PanelId) => void;
		onClose: (id: PanelId) => void;
		onDragPointerDown: (event: PointerEvent, id: PanelId) => void;
		onDragPointerMove: (event: PointerEvent) => void;
		onDragPointerEnd: (event: PointerEvent) => void;
		onMoveByKeyboard: (id: PanelId, direction: -1 | 1) => void;
	}>;

	let {
		node,
		controllers,
		panelCount,
		activePanelId,
		draggingPanelId,
		dropTargetPanelId,
		onActivate,
		onClose,
		onDragPointerDown,
		onDragPointerMove,
		onDragPointerEnd,
		onMoveByKeyboard
	}: Props = $props();
</script>

{#if node.kind === 'split'}
	<div
		class="panel-split"
		data-axis={node.axis}
		data-ratio={node.ratio}
		data-narrow-flow={node.narrowFlow}
	>
		<div class="panel-slot">
			<PanelLayout
				node={node.first}
				{controllers}
				{panelCount}
				{activePanelId}
				{draggingPanelId}
				{dropTargetPanelId}
				{onActivate}
				{onClose}
				{onDragPointerDown}
				{onDragPointerMove}
				{onDragPointerEnd}
				{onMoveByKeyboard}
			/>
		</div>
		<div class="panel-slot">
			<PanelLayout
				node={node.second}
				{controllers}
				{panelCount}
				{activePanelId}
				{draggingPanelId}
				{dropTargetPanelId}
				{onActivate}
				{onClose}
				{onDragPointerDown}
				{onDragPointerMove}
				{onDragPointerEnd}
				{onMoveByKeyboard}
			/>
		</div>
	</div>
{:else}
	{@const controller = controllers.get(node.id)}
	{#if controller}
		{#key node.id}
			<TerminalPanel
				id={node.id}
				{controller}
				mode={node.mode ?? 'interactive'}
				sizing={node.sizing ?? 'fill'}
				label={node.label ?? node.id.replace('-', ' ')}
				active={activePanelId === node.id}
				canClose={panelCount > 1}
				dragging={draggingPanelId === node.id}
				dropTarget={dropTargetPanelId === node.id}
				{onActivate}
				{onClose}
				{onDragPointerDown}
				{onDragPointerMove}
				{onDragPointerEnd}
				{onMoveByKeyboard}
			/>
		{/key}
	{/if}
{/if}
