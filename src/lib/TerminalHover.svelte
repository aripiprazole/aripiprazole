<script lang="ts">
  import { onDestroy, tick } from "svelte";

  import { loadHoverData, type HoverData } from "$lib/api/client";
  import {
    hoverTargetForUrl,
    type HoverTarget,
  } from "$lib/api/hover-target";

  type Props = Readonly<{
    id: string;
    container?: HTMLElement;
  }>;

  let { id, container }: Props = $props();

  let anchor = $state<HTMLAnchorElement | null>(null);
  let pendingAnchor: HTMLAnchorElement | null = null;
  let pendingTarget: HoverTarget | null = null;
  let target = $state<HoverTarget | null>(null);
  let hoverElement = $state<HTMLElement>();
  let data = $state<HoverData | null>(null);
  let error = $state<string | null>(null);
  let loading = $state(false);
  let left = $state(12);
  let edge = $state(12);
  let placement = $state<"above" | "below">("below");
  let maximumHeight = $state(352);
  let openTimer: ReturnType<typeof setTimeout> | null = null;
  let closeTimer: ReturnType<typeof setTimeout> | null = null;
  let request: AbortController | null = null;
  let requestNumber = 0;
  let previousDescribedBy: string | null = null;

  const integer = new Intl.NumberFormat("en-US");
  const compact = new Intl.NumberFormat("en-US", { notation: "compact" });

  const clearTimers = (): void => {
    if (openTimer !== null) clearTimeout(openTimer);
    if (closeTimer !== null) clearTimeout(closeTimer);
    openTimer = null;
    closeTimer = null;
  };

  const cancelScheduledClose = (): void => {
    if (closeTimer !== null) clearTimeout(closeTimer);
    closeTimer = null;
  };

  const position = async (element: HTMLAnchorElement): Promise<void> => {
    const rect = element.getBoundingClientRect();
    const roomBelow = window.innerHeight - rect.bottom;
    const roomAbove = rect.top;
    await tick();
    if (anchor !== element || hoverElement === undefined) return;

    const box = hoverElement.getBoundingClientRect();
    const style = getComputedStyle(hoverElement);
    const borderHeight =
      Number.parseFloat(style.borderTopWidth) +
      Number.parseFloat(style.borderBottomWidth);
    const preferredHeight = Math.min(
      hoverElement.scrollHeight + borderHeight,
      352,
    );
    placement =
      roomBelow >= preferredHeight || roomBelow >= roomAbove ? "below" : "above";
    maximumHeight = Math.max(
      72,
      Math.min(352, (placement === "below" ? roomBelow : roomAbove) - 12),
    );
    left = Math.max(12, Math.min(rect.left, window.innerWidth - box.width - 12));
    edge =
      placement === "below"
        ? rect.bottom + 8
        : window.innerHeight - rect.top + 8;
  };

  const close = (): void => {
    clearTimers();
    request?.abort();
    request = null;
    requestNumber += 1;
    if (anchor !== null) {
      if (previousDescribedBy === null) anchor.removeAttribute("aria-describedby");
      else anchor.setAttribute("aria-describedby", previousDescribedBy);
    }
    anchor = null;
    pendingAnchor = null;
    pendingTarget = null;
    target = null;
    data = null;
    error = null;
    loading = false;
    previousDescribedBy = null;
  };

  const scheduleClose = (): void => {
    if (closeTimer !== null) clearTimeout(closeTimer);
    closeTimer = setTimeout(close, 90);
  };

  const show = (
    element: HTMLAnchorElement,
    nextTarget: HoverTarget,
    delay: number,
  ): void => {
    if (anchor === element && target?.label === nextTarget.label) {
      cancelScheduledClose();
      return;
    }
    if (pendingAnchor === element && pendingTarget?.label === nextTarget.label) {
      return;
    }
    close();
    pendingAnchor = element;
    pendingTarget = nextTarget;

    openTimer = setTimeout(() => {
      pendingAnchor = null;
      pendingTarget = null;
      anchor = element;
      target = nextTarget;
      previousDescribedBy = element.getAttribute("aria-describedby");
      const describedBy = new Set(
        previousDescribedBy?.split(/\s+/u).filter(Boolean) ?? [],
      );
      describedBy.add(id);
      element.setAttribute("aria-describedby", [...describedBy].join(" "));
      void position(element);

      const currentRequest = ++requestNumber;
      const controller = new AbortController();
      request = controller;
      loading = true;
      void loadHoverData(nextTarget, controller.signal)
        .then((value) => {
          if (currentRequest !== requestNumber || anchor !== element) return;
          data = value;
        })
        .catch((reason: unknown) => {
          if (
            currentRequest !== requestNumber ||
            controller.signal.aborted ||
            anchor !== element
          ) {
            return;
          }
          error = reason instanceof Error ? reason.message : "preview unavailable";
        })
        .finally(() => {
          if (currentRequest === requestNumber) loading = false;
        });
    }, delay);
  };

  const matchingAnchor = (event: Event): HTMLAnchorElement | null => {
    const element =
      event.target instanceof Element
        ? event.target.closest<HTMLAnchorElement>("a[href]")
        : null;
    return element !== null && container?.contains(element) ? element : null;
  };

  const begin = (event: Event, delay: number): void => {
    const element = matchingAnchor(event);
    if (element === null) return;
    const nextTarget = hoverTargetForUrl(element.href);
    if (nextTarget !== null) show(element, nextTarget, delay);
  };

  const pointerOver = (event: PointerEvent): void => {
    if (!window.matchMedia("(hover: hover)").matches) return;
    const element = matchingAnchor(event);
    if (
      element !== null &&
      event.relatedTarget instanceof Node &&
      element.contains(event.relatedTarget)
    ) {
      return;
    }
    begin(event, 160);
  };

  const pointerOut = (event: PointerEvent): void => {
    const element = matchingAnchor(event);
    if (element === null) return;
    if (
      event.relatedTarget instanceof Node &&
      element.contains(event.relatedTarget)
    ) {
      return;
    }
    if (element === pendingAnchor) {
      close();
      return;
    }
    if (element !== anchor) return;
    scheduleClose();
  };

  const focusIn = (event: FocusEvent): void => begin(event, 0);

  const focusOut = (event: FocusEvent): void => {
    const element = matchingAnchor(event);
    if (element === pendingAnchor) close();
    else if (element === anchor) scheduleClose();
  };

  const keydown = (event: KeyboardEvent): void => {
    if (event.key === "Escape" && (anchor !== null || pendingAnchor !== null)) {
      close();
    }
  };

  const scroll = (event: Event): void => {
    if (
      hoverElement !== undefined &&
      event.target instanceof Node &&
      hoverElement.contains(event.target)
    ) {
      return;
    }
    close();
  };

  $effect(() => {
    data;
    error;
    loading;
    const currentAnchor = anchor;
    if (currentAnchor !== null) void position(currentAnchor);
  });

  $effect(() => {
    const root = container;
    if (root === undefined) return;
    root.addEventListener("pointerover", pointerOver);
    root.addEventListener("pointerout", pointerOut);
    root.addEventListener("focusin", focusIn);
    root.addEventListener("focusout", focusOut);
    window.addEventListener("keydown", keydown);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", scroll, true);

    return () => {
      root.removeEventListener("pointerover", pointerOver);
      root.removeEventListener("pointerout", pointerOut);
      root.removeEventListener("focusin", focusIn);
      root.removeEventListener("focusout", focusOut);
      window.removeEventListener("keydown", keydown);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", scroll, true);
    };
  });

  onDestroy(close);
</script>

{#if target !== null}
  <aside
    {id}
    bind:this={hoverElement}
    class="terminal-hover"
    data-placement={placement}
    style:left={`${left}px`}
    style:top={placement === "below" ? `${edge}px` : undefined}
    style:bottom={placement === "above" ? `${edge}px` : undefined}
    style:max-height={`${maximumHeight}px`}
    role="tooltip"
    aria-live="polite"
    onpointerenter={cancelScheduledClose}
    onpointerleave={scheduleClose}
  >
    <header class="terminal-hover-heading">
      <span>hover::{target.label}</span>
      {#if loading}<span class="terminal-hover-pending">fetching</span>{/if}
    </header>

    <div class="terminal-hover-body">
      {#if error !== null}
        <p class="terminal-hover-error">{error}</p>
      {:else if data === null}
        <p class="terminal-hover-loading">requesting provider data<span aria-hidden="true">_</span></p>
      {:else if data.value.status === "unavailable"}
        <p class="terminal-hover-error">{data.value.reason}</p>
      {:else if data.kind === "github-project"}
        <p class="terminal-hover-title">{data.value.data.fullName}</p>
        <p>{data.value.data.description ?? "No repository description."}</p>
        <dl class="terminal-hover-grid">
          <div><dt>language</dt><dd>{data.value.data.language ?? "—"}</dd></div>
          <div><dt>stars</dt><dd>{integer.format(data.value.data.stars)}</dd></div>
          <div><dt>forks</dt><dd>{integer.format(data.value.data.forks)}</dd></div>
          <div><dt>issues</dt><dd>{integer.format(data.value.data.openIssues)}</dd></div>
        </dl>
      {:else if data.kind === "github"}
        <p class="terminal-hover-title">@{data.value.data.username}</p>
        <dl class="terminal-hover-grid">
          <div><dt>commits / 7d</dt><dd>{integer.format(data.value.data.commits)}</dd></div>
          <div><dt>active repos</dt><dd>{integer.format(data.value.data.repositories)}</dd></div>
          <div><dt>public repos</dt><dd>{integer.format(data.value.data.publicRepositories)}</dd></div>
          <div><dt>followers</dt><dd>{integer.format(data.value.data.followers)}</dd></div>
        </dl>
      {:else if data.kind === "chess"}
        <p class="terminal-hover-title">{data.value.data.username}</p>
        <p>{data.value.data.wins}w {data.value.data.draws}d {data.value.data.losses}l in the last 7 days</p>
        <dl class="terminal-hover-grid">
          <div><dt>rapid</dt><dd>{data.value.data.ratings.rapid?.rating ?? "—"}</dd></div>
          <div><dt>blitz</dt><dd>{data.value.data.ratings.blitz?.rating ?? "—"}</dd></div>
          <div><dt>bullet</dt><dd>{data.value.data.ratings.bullet?.rating ?? "—"}</dd></div>
          <div><dt>games</dt><dd>{data.value.data.games}</dd></div>
        </dl>
      {:else if data.kind === "wakatime"}
        <p class="terminal-hover-title">{data.value.data.humanReadableTotal} coded</p>
        <p>{data.value.data.range} · {data.value.data.humanReadableDailyAverage} daily</p>
        <dl class="terminal-hover-grid">
          {#each data.value.data.languages.slice(0, 4) as language (language.name)}
            <div><dt>{language.name}</dt><dd>{language.percent.toFixed(1)}%</dd></div>
          {/each}
        </dl>
      {:else if data.kind === "openai"}
        <p class="terminal-hover-title">{compact.format(data.value.data.totalTokens)} tokens / 7d</p>
        <dl class="terminal-hover-grid">
          <div><dt>input</dt><dd>{compact.format(data.value.data.inputTokens)}</dd></div>
          <div><dt>output</dt><dd>{compact.format(data.value.data.outputTokens)}</dd></div>
          <div><dt>cached input</dt><dd>{compact.format(data.value.data.cachedInputTokens)}</dd></div>
          <div><dt>requests</dt><dd>{integer.format(data.value.data.requests)}</dd></div>
        </dl>
      {:else if data.kind === "wynncraft"}
        <p class="terminal-hover-title">{data.value.data.rank ? `[${data.value.data.rank}] ` : ""}{data.value.data.username}</p>
        <p>{data.value.data.online ? `online${data.value.data.server ? ` · ${data.value.data.server}` : ""}` : "offline"}{data.value.data.guild ? ` · ${data.value.data.guild}` : ""}</p>
        <dl class="terminal-hover-grid">
          <div><dt>total level</dt><dd>{data.value.data.totalLevel ?? "—"}</dd></div>
          <div><dt>playtime</dt><dd>{data.value.data.playtimeHours === null ? "—" : `${integer.format(data.value.data.playtimeHours)}h`}</dd></div>
          <div><dt>mobs</dt><dd>{data.value.data.mobsKilled === null ? "—" : compact.format(data.value.data.mobsKilled)}</dd></div>
          <div><dt>classes</dt><dd>{data.value.data.classes.length}</dd></div>
        </dl>
      {/if}
    </div>
  </aside>
{/if}
