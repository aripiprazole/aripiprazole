<script lang="ts">
  import { onMount } from "svelte";

  import {
    nextSuggestionIndex,
    suggestionHoldDurationMs,
    typewriterFrames,
  } from "$lib/terminal-suggestions";

  type Props = Readonly<{
    suggestions: readonly string[];
  }>;

  let { suggestions }: Props = $props();

  let visibleText = $state("");

  const typingDelayMs = 45;
  const deletingDelayMs = 24;

  const wait = (durationMs: number, signal: AbortSignal): Promise<boolean> =>
    new Promise((resolve) => {
      if (signal.aborted) {
        resolve(false);
        return;
      }

      const onAbort = (): void => {
        window.clearTimeout(timeout);
        resolve(false);
      };
      const timeout = window.setTimeout(() => {
        signal.removeEventListener("abort", onAbort);
        resolve(true);
      }, durationMs);
      signal.addEventListener("abort", onAbort, { once: true });
    });

  const animate = async (signal: AbortSignal): Promise<void> => {
    if (suggestions.length === 0) return;

    let suggestionIndex = 0;
    while (!signal.aborted) {
      const suggestion = suggestions[suggestionIndex];
      if (suggestion === undefined) return;

      for (const frame of typewriterFrames(suggestion, "write")) {
        if (!(await wait(typingDelayMs, signal))) return;
        visibleText = frame;
      }

      if (!(await wait(suggestionHoldDurationMs(), signal))) return;

      for (const frame of typewriterFrames(suggestion, "erase")) {
        if (!(await wait(deletingDelayMs, signal))) return;
        visibleText = frame;
      }

      const nextIndex = nextSuggestionIndex(
        suggestionIndex,
        suggestions.length,
      );
      if (nextIndex === null) return;
      suggestionIndex = nextIndex;
    }
  };

  onMount(() => {
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    );
    let animation: AbortController | null = null;

    const start = (): void => {
      animation?.abort();
      animation = new AbortController();

      if (reducedMotion.matches) {
        visibleText = suggestions[0] ?? "";
        return;
      }

      visibleText = "";
      void animate(animation.signal);
    };

    reducedMotion.addEventListener("change", start);
    start();

    return () => {
      reducedMotion.removeEventListener("change", start);
      animation?.abort();
    };
  });
</script>

<span class="prompt-suggestion" aria-hidden="true"
  >{visibleText}<span class="prompt-suggestion-cursor"></span></span
>
