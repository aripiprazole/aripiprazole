<script lang="ts">
  import { onMount, tick } from "svelte";

  import HighlightedCommand from "$lib/HighlightedCommand.svelte";
  import TerminalSuggestion from "$lib/TerminalSuggestion.svelte";
  import type { PanelId, PanelMode, PanelSizing } from "$lib/panel-layout";
  import {
    completeShellInput,
    cycleCompletionIndex,
    type CompletionDirection,
    type ShellCompletionCandidate,
  } from "$lib/shell/input";
  import type { CommandAction } from "$lib/shell/types";
  import {
    shouldShowTerminalSuggestion,
    terminalSuggestions,
  } from "$lib/terminal-suggestions";
  import type {
    SubmissionSource,
    TerminalController,
    TerminalOutputChunk,
  } from "$lib/terminal.svelte";

  type InlineAction = Readonly<{
    action: CommandAction;
    before: string;
    after: string;
  }>;

  type CompletionSession = Readonly<{
    candidates: readonly ShellCompletionCandidate[];
  }>;

  type Props = Readonly<{
    id: PanelId;
    controller: TerminalController;
    mode: PanelMode;
    sizing: PanelSizing;
    label: string;
    active: boolean;
    canClose: boolean;
    dragging: boolean;
    dropTarget: boolean;
    onActivate: (id: PanelId) => void;
    onClose: (id: PanelId) => void;
    onDragPointerDown: (event: PointerEvent, id: PanelId) => void;
    onDragPointerMove: (event: PointerEvent) => void;
    onDragPointerEnd: (event: PointerEvent) => void;
    onMoveByKeyboard: (id: PanelId, direction: -1 | 1) => void;
  }>;

  let {
    id,
    controller,
    mode,
    sizing,
    label,
    active,
    canClose,
    dragging,
    dropTarget,
    onActivate,
    onClose,
    onDragPointerDown,
    onDragPointerMove,
    onDragPointerEnd,
    onMoveByKeyboard,
  }: Props = $props();

  let terminalState = $derived(controller.state);
  let inputElement = $state<HTMLInputElement>();
  let completionRailElement = $state<HTMLElement>();
  let inputSelectionStart = $state(0);
  let inputSelectionEnd = $state(0);
  let inputScrollLeft = $state(0);
  let completionCandidates = $state<readonly ShellCompletionCandidate[]>([]);
  let completionSession = $state<CompletionSession | null>(null);
  let activeCompletionIndex = $state<number | null>(null);
  let completionDismissed = $state(false);
  let suggestionDismissed = $state(false);
  let completionRequest = 0;
  let applyingCompletion = false;
  let completionListId = $derived(`terminal-completions-${id}`);
  let suggestionDescriptionId = $derived(`terminal-suggestion-${id}`);
  let activeCompletionOptionId = $derived(
    activeCompletionIndex === null
      ? undefined
      : `${completionListId}-option-${activeCompletionIndex}`,
  );
  let showSuggestion = $derived(
    shouldShowTerminalSuggestion({
      active,
      mode,
      phase: terminalState.phase,
      draft: terminalState.draft,
      dismissed: suggestionDismissed,
    }),
  );

  const documentFollowsTail = (): boolean =>
    document.documentElement.scrollHeight -
      window.scrollY -
      window.innerHeight <
    72;

  const submitAndReveal = (command: string, source: SubmissionSource): void => {
    const shouldReveal = documentFollowsTail();
    const startingScrollY = window.scrollY;
    void controller.submitCommand(command, source).then(async () => {
      if (!shouldReveal || Math.abs(window.scrollY - startingScrollY) > 2)
        return;
      await tick();
      inputElement?.scrollIntoView({ block: "nearest", inline: "nearest" });
    });
  };

  const dismissSuggestion = (): void => {
    suggestionDismissed = true;
  };

  const focusInput = async (force = false): Promise<void> => {
    await tick();
    if (!active) return;
    if (force || window.matchMedia("(pointer: fine)").matches) {
      inputElement?.focus({ preventScroll: true });
    }
  };

  const revealInputCaret = (): void => {
    void tick().then(() => {
      const input = inputElement;
      if (input === undefined) return;
      const cursor = input.selectionStart ?? terminalState.draft.length;
      const contentWidth = input.scrollWidth;
      const viewportWidth = input.clientWidth;

      if (contentWidth <= viewportWidth || terminalState.draft.length === 0) {
        input.scrollLeft = 0;
        inputScrollLeft = 0;
        return;
      }

      const characterWidth = contentWidth / terminalState.draft.length;
      const cursorOffset = cursor * characterWidth;
      const gutter = characterWidth * 2;
      if (cursorOffset < input.scrollLeft + gutter) {
        input.scrollLeft = Math.max(0, cursorOffset - gutter);
      } else if (cursorOffset > input.scrollLeft + viewportWidth - gutter) {
        input.scrollLeft = Math.min(
          contentWidth - viewportWidth,
          cursorOffset - viewportWidth + gutter,
        );
      }
      inputScrollLeft = input.scrollLeft;
    });
  };

  const syncInputGeometry = (): void => {
    const input = inputElement;
    if (input === undefined) return;
    inputSelectionStart = input.selectionStart ?? terminalState.draft.length;
    inputSelectionEnd = input.selectionEnd ?? inputSelectionStart;
    inputScrollLeft = input.scrollLeft;
    revealInputCaret();
  };

  const resetCompletionInteraction = (): void => {
    completionSession = null;
    activeCompletionIndex = null;
    completionDismissed = false;
  };

  const positionInput = async (
    cursor: number,
    forceFocus = false,
  ): Promise<void> => {
    await tick();
    const input = inputElement;
    if (input === undefined) return;

    if (forceFocus || window.matchMedia("(pointer: fine)").matches) {
      input.focus({ preventScroll: true });
    }

    applyingCompletion = true;
    input.setSelectionRange(cursor, cursor);
    inputSelectionStart = cursor;
    inputSelectionEnd = cursor;
    inputScrollLeft = input.scrollLeft;
    applyingCompletion = false;
    revealInputCaret();
  };

  const revealActiveCompletion = async (): Promise<void> => {
    await tick();
    completionRailElement
      ?.querySelector<HTMLElement>('[data-active="true"]')
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  };

  const submit = (event: SubmitEvent): void => {
    event.preventDefault();
    const command = terminalState.draft;
    if (command.trim().length === 0) return;
    completionSession = null;
    completionCandidates = [];
    activeCompletionIndex = null;
    submitAndReveal(command, "keyboard");
  };

  const activate = (action: CommandAction): void => {
    if (action.behavior === "execute") {
      submitAndReveal(action.command, "action");
      return;
    }

    controller.activateCommandAction(action);
    resetCompletionInteraction();
    inputSelectionStart = action.command.length;
    inputSelectionEnd = action.command.length;
    void positionInput(action.command.length);
  };

  const inlineAction = (output: TerminalOutputChunk): InlineAction | null => {
    if (!output.revealed || output.actions.length !== 1) return null;
    const action = output.actions[0];
    if (action === undefined) return null;
    const actionOffset = output.visibleText.lastIndexOf(action.label);
    if (actionOffset < 0) return null;

    return {
      action,
      before: output.visibleText.slice(0, actionOffset),
      after: output.visibleText.slice(actionOffset + action.label.length),
    };
  };

  const applyCompletion = (
    candidate: ShellCompletionCandidate,
    forceFocus: boolean,
  ): void => {
    terminalState.draft = candidate.draft;
    inputSelectionStart = candidate.cursor;
    inputSelectionEnd = candidate.cursor;
    terminalState.historyIndex = null;
    terminalState.announcement = `Completed ${candidate.label}`;
    void positionInput(candidate.cursor, forceFocus);
  };

  const cycleCompletion = (direction: CompletionDirection): boolean => {
    const candidates = completionSession?.candidates ?? completionCandidates;
    const nextIndex = cycleCompletionIndex(
      completionSession === null ? null : activeCompletionIndex,
      candidates.length,
      direction,
    );
    if (nextIndex === null) return false;

    completionSession ??= { candidates };
    activeCompletionIndex = nextIndex;
    const candidate = candidates[nextIndex];
    if (candidate === undefined) return false;

    applyCompletion(candidate, false);
    terminalState.announcement = `${candidate.label}, completion ${nextIndex + 1} of ${candidates.length}`;
    void revealActiveCompletion();
    return true;
  };

  const insertCompletion = (candidate: ShellCompletionCandidate): void => {
    completionSession = null;
    activeCompletionIndex = null;
    completionDismissed = false;
    applyCompletion(candidate, true);
  };

  const dismissCompletion = (): void => {
    completionSession = null;
    completionCandidates = [];
    activeCompletionIndex = null;
    completionDismissed = true;
    terminalState.announcement = "Completion dismissed";
  };

  const recallHistory = (direction: "previous" | "next"): void => {
    if (direction === "previous") controller.recallPreviousCommand();
    else controller.recallNextCommand();
    resetCompletionInteraction();
    const cursor = terminalState.draft.length;
    inputSelectionStart = cursor;
    inputSelectionEnd = cursor;
    void positionInput(cursor);
  };

  const keydown = (event: KeyboardEvent): void => {
    if (event.key === "Tab" && !event.altKey && !event.metaKey) {
      if (cycleCompletion(event.shiftKey ? -1 : 1)) event.preventDefault();
      return;
    }

    if (event.key === "Escape" && completionCandidates.length > 0) {
      event.preventDefault();
      dismissCompletion();
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      recallHistory("previous");
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      recallHistory("next");
    }
  };

  const input = (): void => {
    controller.resetHistoryNavigation();
    resetCompletionInteraction();
    syncInputGeometry();
  };

  const selectInput = (): void => {
    syncInputGeometry();
    if (!applyingCompletion) resetCompletionInteraction();
  };

  const scrollInput = (): void => {
    inputScrollLeft = inputElement?.scrollLeft ?? 0;
  };

  const dragHandleKeydown = (event: KeyboardEvent): void => {
    if (!event.altKey) return;
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      onMoveByKeyboard(id, -1);
    } else if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      onMoveByKeyboard(id, 1);
    }
  };

  $effect(() => {
    if (mode === "interactive" && active && terminalState.phase === "idle") {
      void focusInput();
    }
  });

  $effect(() => {
    const phase = terminalState.phase;
    const draft = terminalState.draft;
    const cwd = terminalState.cwd;
    const selectionStart = inputSelectionStart;
    const selectionEnd = inputSelectionEnd;
    const dismissed = completionDismissed;
    const session = completionSession;
    const request = ++completionRequest;

    if (
      mode !== "interactive" ||
      phase !== "idle" ||
      draft.trim().length === 0 ||
      selectionStart !== selectionEnd ||
      dismissed
    ) {
      completionCandidates = [];
      return;
    }

    if (session !== null) {
      completionCandidates = session.candidates;
      return;
    }

    void completeShellInput(draft, selectionStart, cwd).then((candidates) => {
      if (request !== completionRequest) return;
      completionCandidates = candidates;
      activeCompletionIndex = null;
    });
  });

  onMount(() => controller.boot());
</script>

<section
  class="terminal-panel"
  data-panel-id={id}
  data-active={active}
  data-dragging={dragging}
  data-drop-target={dropTarget}
  data-mode={mode}
  data-sizing={sizing}
  aria-label={`${label} at ${terminalState.cwd}`}
  onfocusin={() => onActivate(id)}
>
  <header class="panel-heading">
    <button
      class="panel-drag-handle"
      type="button"
      aria-label={`move ${label} at ${terminalState.cwd}. use alt and arrow keys to reorder.`}
      aria-keyshortcuts="Alt+ArrowLeft Alt+ArrowRight Alt+ArrowUp Alt+ArrowDown"
      title="drag to reorder · alt+arrow to move"
      onpointerdown={(event) => onDragPointerDown(event, id)}
      onpointermove={onDragPointerMove}
      onpointerup={onDragPointerEnd}
      onpointercancel={onDragPointerEnd}
      onkeydown={dragHandleKeydown}
    >
      <span class="panel-cwd">aripiprazole@web:{terminalState.cwd}</span>
    </button>
    <button
      class="panel-close"
      type="button"
      disabled={!canClose}
      aria-label={canClose
        ? `close ${label} at ${terminalState.cwd}`
        : `the last ${label} cannot be closed`}
      onpointerdown={(event) => event.stopPropagation()}
      onclick={(event) => {
        event.stopPropagation();
        onClose(id);
      }}>[x]</button
    >
  </header>

  <div class="terminal">
    <div
      class="terminal-transcript"
      onpointerdown={() => onActivate(id)}
      role={mode === "interactive" ? "log" : undefined}
      aria-live={mode === "interactive" ? "off" : undefined}
      aria-busy={terminalState.phase !== "idle"}
    >
      {#each terminalState.transcript as entry (entry.id)}
        <article class="terminal-entry" data-status={entry.status}>
          <div class="prompt-row transcript-prompt">
            <span class="prompt-symbol">$</span>
            <HighlightedCommand
              source={entry.visibleCommand}
              className="prompt-command"
            />
            {#if terminalState.cursor.kind === "command" && terminalState.cursor.entryId === entry.id}
              <span class="terminal-cursor" aria-hidden="true"></span>
            {/if}
            {#if entry.exitCode !== undefined && entry.exitCode !== 0}
              <span class="exit-status">exit {entry.exitCode}</span>
            {/if}
          </div>

          {#each entry.chunks as output (output.id)}
            {@const linkedOutput = inlineAction(output)}
            <div class:stderr={output.stream === "stderr"} class="output-block">
              {#if output.revealed && output.presentation?.kind === "html"}
                <div class="terminal-html">
                  {@html output.presentation.html}
                </div>
              {:else if output.revealed && output.presentation?.kind === "image"}
                <figure class="terminal-image-frame">
                  <img
                    src={output.presentation.src}
                    alt={output.presentation.alt}
                    style={`border-radius: ${output.presentation.borderRadius}px`}
                  />
                </figure>
              {:else}
                <pre>{#if linkedOutput}{linkedOutput.before}<button
                      class="terminal-link"
                      type="button"
                      onclick={() => activate(linkedOutput.action)}
                      aria-label={`${linkedOutput.action.behavior === "execute" ? "Run" : "Insert"} ${linkedOutput.action.command}`}
                      >{linkedOutput.action.label}</button
                    >{linkedOutput.after}{:else}{output.visibleText}{#if terminalState.cursor.kind === "output" && terminalState.cursor.chunkId === output.id}<span
                        class="terminal-cursor output-cursor"
                        aria-hidden="true"></span>{/if}{/if}</pre>
              {/if}

              {#if output.revealed && output.actions.length > 0 && linkedOutput === null}
                <div class="command-actions" aria-label="Suggested commands">
                  {#each output.actions as action (`${output.id}:${action.command}:${action.behavior}`)}
                    <button
                      type="button"
                      class="command-action"
                      onclick={() => activate(action)}
                      aria-label={`${action.behavior === "execute" ? "Run" : "Insert"} ${action.command}`}
                    >
                      <span>{action.label}</span>
                    </button>
                  {/each}
                </div>
              {/if}
            </div>
          {/each}
        </article>
      {/each}

      {#if terminalState.phase === "typing-command"}
        <div class="prompt-row active-prompt" aria-label="Typing command">
          <span class="prompt-symbol">$</span>
          <HighlightedCommand
            source={terminalState.draft}
            className="prompt-command"
          />
          {#if terminalState.cursor.kind === "draft"}
            <span class="terminal-cursor" aria-hidden="true"></span>
          {/if}
        </div>
      {:else if terminalState.phase === "idle" && mode === "interactive"}
        <div class="prompt-composer">
          <form
            class="prompt-row active-prompt"
            onpointerdown={dismissSuggestion}
            onsubmit={submit}
          >
            <label class="prompt-prefix" for={`terminal-command-${id}`}>
              <span class="prompt-symbol">$</span>
            </label>
            <div class="prompt-input" data-suggesting={showSuggestion}>
              <div class="prompt-highlight" aria-hidden="true">
                <div
                  class="prompt-highlight-scroll"
                  style:transform={`translateX(-${inputScrollLeft}px)`}
                >
                  <HighlightedCommand source={terminalState.draft} />
                </div>
              </div>
              {#if showSuggestion}
                <TerminalSuggestion suggestions={terminalSuggestions} />
                <span
                  id={suggestionDescriptionId}
                  class="screen-reader-status"
                >
                  Suggested commands: {terminalSuggestions.join("; ")}
                </span>
              {/if}
              <input
                id={`terminal-command-${id}`}
                bind:this={inputElement}
                bind:value={terminalState.draft}
                oninput={input}
                onkeydown={keydown}
                onselect={selectInput}
                onclick={selectInput}
                onscroll={scrollInput}
                type="text"
                role="combobox"
                aria-label={`command in ${label} at ${terminalState.cwd}`}
                aria-describedby={showSuggestion
                  ? suggestionDescriptionId
                  : undefined}
                aria-autocomplete="list"
                aria-expanded={completionCandidates.length > 0}
                aria-controls={completionCandidates.length > 0
                  ? completionListId
                  : undefined}
                aria-activedescendant={activeCompletionOptionId}
                autocomplete="off"
                autocapitalize="none"
                spellcheck="false"
                enterkeyhint="send"
              />
            </div>
          </form>

          {#if completionCandidates.length > 0}
            <div
              class="completion-rail"
              bind:this={completionRailElement}
              id={completionListId}
              role="listbox"
              aria-label={`command completions for ${label}`}
            >
              {#each completionCandidates as candidate, index (`${candidate.kind}:${candidate.label}:${candidate.draft}`)}
                <button
                  id={`${completionListId}-option-${index}`}
                  type="button"
                  role="option"
                  class="completion-option"
                  data-kind={candidate.kind}
                  data-active={activeCompletionIndex === index}
                  aria-selected={activeCompletionIndex === index}
                  aria-label={`complete ${candidate.label}`}
                  tabindex={-1}
                  onpointerdown={(event) => event.preventDefault()}
                  onclick={() => insertCompletion(candidate)}
                  >{candidate.label}</button
                >
              {/each}
            </div>
          {/if}
        </div>
      {:else if terminalState.phase === "idle" && mode === "output-only" && canClose}
        <button
          class="process-finish"
          type="button"
          aria-label={`finish process in ${label}`}
          aria-keyshortcuts="Control+C"
          title="finish process · ctrl+c"
          onclick={() => onClose(id)}
          >[ click <kbd>ctrl c</kbd> to finish process ]</button
        >
      {/if}
    </div>
  </div>

  {#if mode === "interactive"}
    <p class="screen-reader-status" aria-live="polite">
      {terminalState.announcement}
    </p>
  {/if}
</section>
