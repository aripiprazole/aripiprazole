import { describe, expect, test } from "bun:test";

import {
  nextSuggestionIndex,
  shouldShowTerminalSuggestion,
  suggestionHoldDurationMs,
  terminalSuggestions,
  typewriterFrames,
} from "./terminal-suggestions";

describe("terminal prompt suggestions", () => {
  test("preserves the requested plain-text suggestion and literal backticks", () => {
    expect(terminalSuggestions[0]).toBe(
      "type `cd writings/` to read my blogposts",
    );
  });

  test("builds writing and deleting frames by Unicode code point", () => {
    expect(typewriterFrames("A🧠", "write")).toEqual(["A", "A🧠"]);
    expect(typewriterFrames("A🧠", "erase")).toEqual(["A", ""]);
  });

  test("chooses any suggestion except the current one", () => {
    expect(nextSuggestionIndex(1, 4, () => 0)).toBe(2);
    expect(nextSuggestionIndex(1, 4, () => 0.999_999)).toBe(0);

    for (let index = 0; index < 4; index += 1) {
      expect(nextSuggestionIndex(index, 4, () => 0.5)).not.toBe(index);
    }
  });

  test("handles lists that cannot switch", () => {
    expect(nextSuggestionIndex(0, 0)).toBeNull();
    expect(nextSuggestionIndex(0, 1)).toBe(0);
  });

  test("holds a finished suggestion for a random three to five seconds", () => {
    expect(suggestionHoldDurationMs(() => 0)).toBe(3_000);
    expect(suggestionHoldDurationMs(() => 0.5)).toBe(4_000);
    expect(suggestionHoldDurationMs(() => 0.999_999)).toBe(5_000);
  });

  test("shows only in an active empty interactive prompt", () => {
    const idlePrompt = {
      active: true,
      mode: "interactive" as const,
      phase: "idle" as const,
      draft: "",
      dismissed: false,
    };

    expect(shouldShowTerminalSuggestion(idlePrompt)).toBe(true);
    expect(
      shouldShowTerminalSuggestion({ ...idlePrompt, active: false }),
    ).toBe(false);
    expect(
      shouldShowTerminalSuggestion({ ...idlePrompt, draft: "c" }),
    ).toBe(false);
    expect(
      shouldShowTerminalSuggestion({ ...idlePrompt, phase: "running" }),
    ).toBe(false);
    expect(
      shouldShowTerminalSuggestion({ ...idlePrompt, mode: "output-only" }),
    ).toBe(false);
    expect(
      shouldShowTerminalSuggestion({ ...idlePrompt, dismissed: true }),
    ).toBe(false);
  });
});
