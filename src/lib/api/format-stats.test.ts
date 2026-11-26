import { describe, expect, test } from "bun:test";

import type { StatsResponse } from "./contracts";
import { formatStats } from "./format-stats";

describe("formatStats", () => {
  test("formats available providers while preserving partial failures", () => {
    const stats = {
      period: {
        start: "2026-08-03T00:00:00.000Z",
        end: "2026-08-10T00:00:00.000Z",
        label: "Aug 3–9, 2026",
      },
      generatedAt: "2026-08-10T00:00:01.000Z",
      github: {
        status: "ok",
        data: {
          username: "aripiprazole",
          profileUrl: "https://github.com/aripiprazole",
          avatarUrl: "https://example.com/avatar.png",
          commits: 17,
          repositories: 4,
          pullRequests: 2,
          issues: 1,
          reviews: 3,
          publicRepositories: 42,
          followers: 99,
        },
      },
      wakatime: {
        status: "unavailable",
        reason: "public range disabled",
      },
      openai: {
        status: "ok",
        data: {
          inputTokens: 10_000,
          outputTokens: 2_345,
          cachedInputTokens: 500,
          totalTokens: 12_345,
          requests: 3,
        },
      },
      chess: {
        status: "ok",
        data: {
          username: "iogabx",
          profileUrl: "https://www.chess.com/member/iogabx",
          avatarUrl: null,
          ratings: {
            rapid: null,
            blitz: { rating: 1_842, best: 1_900 },
            bullet: null,
            daily: null,
          },
          games: 6,
          wins: 2,
          losses: 3,
          draws: 1,
          byTimeClass: { rapid: 0, blitz: 6, bullet: 0, daily: 0 },
          averageAccuracy: null,
        },
      },
    } satisfies StatsResponse;

    expect(formatStats(stats)).toBe(
      [
        "weekly status · Aug 3–9, 2026",
        "",
        "github    17 commits · 4 repos · 2 prs",
        "wakatime  [unavailable: public range disabled]",
        "openai    12K tokens · 3 requests (10K in / 2.3K out)",
        "chess     2w 1d 3l · rapid — · blitz 1,842",
        "",
      ].join("\n"),
    );
  });

  test("handles empty language data and unavailable provider slots", () => {
    const stats = {
      period: {
        start: "2026-08-03T00:00:00.000Z",
        end: "2026-08-10T00:00:00.000Z",
        label: "this week",
      },
      generatedAt: "2026-08-10T00:00:01.000Z",
      github: { status: "unavailable", reason: "github timeout" },
      wakatime: {
        status: "ok",
        data: {
          username: "aripiprazole",
          range: "last_7_days",
          totalSeconds: 0,
          dailyAverageSeconds: 0,
          humanReadableTotal: "0 secs",
          humanReadableDailyAverage: "0 secs",
          languages: [],
          projects: [],
          isUpToDate: true,
        },
      },
      openai: { status: "unavailable", reason: "not configured" },
      chess: { status: "unavailable", reason: "chess timeout" },
    } satisfies StatsResponse;

    expect(formatStats(stats)).toContain("wakatime  0 secs · no language data\n");
    expect(formatStats(stats)).toContain(
      "github    [unavailable: github timeout]\n",
    );
    expect(formatStats(stats)).toContain(
      "openai    [unavailable: not configured]\n",
    );
    expect(formatStats(stats)).toContain(
      "chess     [unavailable: chess timeout]\n",
    );
  });
});
