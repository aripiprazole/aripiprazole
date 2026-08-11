import type { StatsResponse } from "$lib/api/contracts";

const count = new Intl.NumberFormat("en-US", { notation: "compact" });
const exactCount = new Intl.NumberFormat("en-US");

const rating = (
  value: { rating: number; best: number } | null,
): string => (value === null ? "—" : exactCount.format(value.rating));

export const formatStats = (stats: StatsResponse): string => {
  const lines = [`weekly status · ${stats.period.label}`, ""];

  lines.push(
    stats.github.status === "ok"
      ? `github    ${exactCount.format(stats.github.data.commits)} commits · ${exactCount.format(stats.github.data.repositories)} repos · ${exactCount.format(stats.github.data.pullRequests)} prs`
      : `github    [unavailable: ${stats.github.reason}]`,
  );

  lines.push(
    stats.wakatime.status === "ok"
      ? `wakatime  ${stats.wakatime.data.humanReadableTotal} · ${stats.wakatime.data.languages[0]?.name ?? "no language data"}`
      : `wakatime  [unavailable: ${stats.wakatime.reason}]`,
  );

  lines.push(
    stats.openai.status === "ok"
      ? `openai    ${count.format(stats.openai.data.totalTokens)} tokens · ${exactCount.format(stats.openai.data.requests)} requests (${count.format(stats.openai.data.inputTokens)} in / ${count.format(stats.openai.data.outputTokens)} out)`
      : `openai    [unavailable: ${stats.openai.reason}]`,
  );

  lines.push(
    stats.chess.status === "ok"
      ? `chess     ${stats.chess.data.wins}w ${stats.chess.data.draws}d ${stats.chess.data.losses}l · rapid ${rating(stats.chess.data.ratings.rapid)} · blitz ${rating(stats.chess.data.ratings.blitz)}`
      : `chess     [unavailable: ${stats.chess.reason}]`,
  );

  return `${lines.join("\n")}\n`;
};
