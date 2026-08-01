export const terminalSuggestions = [
  "type `cd writings/` to read my blogposts",
  "type `cd projects/` to browse my projects",
  "type `ls -la` to look around",
  "type `split` to open another terminal",
] as const;

export type TypewriterDirection = "write" | "erase";

export const typewriterFrames = (
  text: string,
  direction: TypewriterDirection,
): readonly string[] => {
  const characters = Array.from(text);

  if (direction === "write") {
    return characters.map((_, index) =>
      characters.slice(0, index + 1).join(""),
    );
  }

  return characters.map((_, index) =>
    characters.slice(0, characters.length - index - 1).join(""),
  );
};

export const nextSuggestionIndex = (
  currentIndex: number,
  suggestionCount: number,
  random: () => number = Math.random,
): number | null => {
  if (suggestionCount <= 0) return null;
  if (suggestionCount === 1) return 0;

  const randomValue = random();
  const unit = Number.isFinite(randomValue)
    ? Math.min(Math.max(randomValue, 0), 1 - Number.EPSILON)
    : 0;
  const offset = 1 + Math.floor(unit * (suggestionCount - 1));
  const normalizedCurrent =
    Number.isInteger(currentIndex) &&
    currentIndex >= 0 &&
    currentIndex < suggestionCount
      ? currentIndex
      : 0;

  return (normalizedCurrent + offset) % suggestionCount;
};

export const suggestionHoldDurationMs = (
  random: () => number = Math.random,
): number => {
  const randomValue = random();
  const unit = Number.isFinite(randomValue)
    ? Math.min(Math.max(randomValue, 0), 1 - Number.EPSILON)
    : 0;

  return 3_000 + Math.floor(unit * 2_001);
};

export const shouldShowTerminalSuggestion = ({
  active,
  mode,
  phase,
  draft,
  dismissed,
}: Readonly<{
  active: boolean;
  mode: "interactive" | "output-only";
  phase: "idle" | "typing-command" | "running" | "typing-output";
  draft: string;
  dismissed: boolean;
}>): boolean =>
  active &&
  mode === "interactive" &&
  phase === "idle" &&
  draft.length === 0 &&
  !dismissed;
