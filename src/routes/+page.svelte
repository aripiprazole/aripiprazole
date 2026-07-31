<script lang="ts">
  import { onDestroy, onMount } from "svelte";

  import PanelLayout from "$lib/PanelLayout.svelte";
  import {
    closePanel,
    movePanel,
    nextSplitAxis,
    panelIds,
    panelLeaf,
    prioritizeNarrowPanel,
    splitPanel,
    type PanelId,
    type PanelLayout as Layout,
    type SplitAxis,
  } from "$lib/panel-layout";
  import type { AbsolutePath } from "$lib/shell/types";
  import {
    createTerminalController,
    type TerminalController,
  } from "$lib/terminal.svelte";

  type PointerDrag = Readonly<{
    sourceId: PanelId;
    pointerId: number;
    startX: number;
    startY: number;
    active: boolean;
    targetId: PanelId | null;
  }>;

  const controllers = new Map<PanelId, TerminalController>();
  let nextPanelNumber = 1;
  let dragHandle: HTMLElement | null = null;

  function createPanel(
    initialCwd?: AbsolutePath,
    startupCommands: readonly string[] = [],
  ): PanelId {
    const id = `terminal-${nextPanelNumber++}`;
    const controller = createTerminalController({
      initialCwd,
      startupCommands,
      onSplit: () => splitFrom(id),
    });
    controllers.set(id, controller);
    return id;
  }

  const contentPanelId = createPanel(undefined, [
    "cat readme.md",
    "cat works.md",
    "ls -la",
  ]);
  const profilePanelId = createPanel(undefined, [
    "png --radius 18 profile.png",
  ]);
  const linksPanelId = createPanel(undefined, ["cat links.md"]);
  const outputOnlyPanelIds = new Set<PanelId>([
    profilePanelId,
    linksPanelId,
  ]);
  let layout = $state<Layout>({
    kind: "split",
    axis: "horizontal",
    ratio: "3:1",
    first: panelLeaf(contentPanelId, {
      sizing: "fill",
      label: "portfolio terminal",
    }),
    second: {
      kind: "split",
      axis: "vertical",
      narrowFlow: "wrap",
      first: panelLeaf(profilePanelId, {
        sizing: "intrinsic",
        mode: "output-only",
        narrowPriority: "first",
        label: "profile terminal",
      }),
      second: panelLeaf(linksPanelId, {
        sizing: "intrinsic",
        mode: "output-only",
        label: "socials terminal",
      }),
    },
  });
  let narrowLayout = $state(false);
  let activePanelId = $state<PanelId>(contentPanelId);
  let nextAxis = $state<SplitAxis>("horizontal");
  let pointerDrag = $state<PointerDrag | null>(null);
  let panelCount = $derived(panelIds(layout).length);
  let draggingPanelId = $derived(
    pointerDrag?.active ? pointerDrag.sourceId : null,
  );
  let dropTargetPanelId = $derived(
    pointerDrag?.active ? pointerDrag.targetId : null,
  );
  let renderedLayout = $derived(
    narrowLayout ? prioritizeNarrowPanel(layout) : layout,
  );

  function splitFrom(sourceId: PanelId): void {
    if (!panelIds(layout).includes(sourceId)) return;
    const source = controllers.get(sourceId);
    if (source === undefined) return;

    const newPanelId = createPanel(source.state.cwd);
    layout = splitPanel(layout, sourceId, newPanelId, nextAxis);
    nextAxis = nextSplitAxis(nextAxis);
    activePanelId = newPanelId;
  }

  const activatePanel = (id: PanelId): void => {
    if (!outputOnlyPanelIds.has(id) && controllers.has(id)) activePanelId = id;
  };

  const cancelPointerDrag = (): void => {
    const current = pointerDrag;
    if (current !== null && dragHandle?.hasPointerCapture(current.pointerId)) {
      dragHandle.releasePointerCapture(current.pointerId);
    }
    pointerDrag = null;
    dragHandle = null;
  };

  const closeTerminal = (id: PanelId): void => {
    const idsBefore = panelIds(layout);
    if (idsBefore.length <= 1) return;
    const closedIndex = idsBefore.indexOf(id);
    const nextLayout = closePanel(layout, id);
    if (closedIndex < 0 || nextLayout === null) return;

    if (pointerDrag?.sourceId === id || pointerDrag?.targetId === id) {
      cancelPointerDrag();
    }
    controllers.get(id)?.dispose();
    controllers.delete(id);
    layout = nextLayout;

    if (activePanelId === id) {
      const idsAfter = panelIds(nextLayout);
      activePanelId = idsAfter[Math.min(closedIndex, idsAfter.length - 1)]!;
    }
  };

  const dragPointerDown = (event: PointerEvent, id: PanelId): void => {
    if (event.button !== 0) return;
    const handle = event.currentTarget;
    if (!(handle instanceof HTMLElement)) return;

    activatePanel(id);
    handle.setPointerCapture(event.pointerId);
    dragHandle = handle;
    pointerDrag = {
      sourceId: id,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      active: false,
      targetId: null,
    };
  };

  const dragPointerMove = (event: PointerEvent): void => {
    const current = pointerDrag;
    if (current === null || current.pointerId !== event.pointerId) return;

    const distance = Math.hypot(
      event.clientX - current.startX,
      event.clientY - current.startY,
    );
    if (!current.active && distance < 5) return;

    event.preventDefault();
    const target = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest<HTMLElement>("[data-panel-id]")?.dataset.panelId;
    pointerDrag = {
      ...current,
      active: true,
      targetId:
        target !== undefined &&
        target !== current.sourceId &&
        controllers.has(target)
          ? target
          : null,
    };
  };

  const dragPointerEnd = (event: PointerEvent): void => {
    const current = pointerDrag;
    if (current === null || current.pointerId !== event.pointerId) return;

    if (
      event.type === "pointerup" &&
      current.active &&
      current.targetId !== null
    ) {
      layout = movePanel(layout, current.sourceId, current.targetId);
      activatePanel(current.sourceId);
    }
    cancelPointerDrag();
  };

  const moveByKeyboard = (id: PanelId, direction: -1 | 1): void => {
    const ids = panelIds(layout);
    const index = ids.indexOf(id);
    const target = ids[index + direction];
    if (index < 0 || target === undefined) return;
    layout = movePanel(layout, id, target);
    activatePanel(id);
  };

  const globalKeydown = (event: KeyboardEvent): void => {
    if (event.key === "Escape" && pointerDrag !== null) {
      event.preventDefault();
      cancelPointerDrag();
      return;
    }

    if (!event.ctrlKey) return;
    const key = event.key.toLowerCase();
    if (key !== "c" && key !== "l") return;

    if (key === "c") {
      const selection = window.getSelection()?.toString() ?? "";
      const target = event.target;
      const inputHasSelection =
        target instanceof HTMLInputElement &&
        (target.selectionStart ?? 0) !== (target.selectionEnd ?? 0);
      if (selection.length > 0 || inputHasSelection) return;
    }

    const controller = controllers.get(activePanelId);
    if (controller === undefined) return;
    event.preventDefault();
    if (key === "c") controller.abortActiveCommand();
    else controller.clearTranscript();
  };

  onDestroy(() => {
    cancelPointerDrag();
    for (const controller of controllers.values()) controller.dispose();
  });

  onMount(() => {
    const mediaQuery = window.matchMedia("(max-width: 64rem)");
    const updateLayoutMode = (): void => {
      narrowLayout = mediaQuery.matches;
    };
    updateLayoutMode();
    mediaQuery.addEventListener("change", updateLayoutMode);
    return () => mediaQuery.removeEventListener("change", updateLayoutMode);
  });
</script>

<svelte:window onkeydown={globalKeydown} />

<main class="terminal-page">
  <div class="terminal-workspace" aria-label="interactive portfolio terminals">
    <PanelLayout
      node={renderedLayout}
      {controllers}
      {panelCount}
      {activePanelId}
      {draggingPanelId}
      {dropTargetPanelId}
      onActivate={activatePanel}
      onClose={closeTerminal}
      onDragPointerDown={dragPointerDown}
      onDragPointerMove={dragPointerMove}
      onDragPointerEnd={dragPointerEnd}
      onMoveByKeyboard={moveByKeyboard}
    />
    <footer class="workspace-footer" aria-label="terminal controls">
      <span><kbd>tab</kbd> / <kbd>shift+tab</kbd> complete</span>
      <span>drag and drop panels</span>
    </footer>
  </div>
</main>
