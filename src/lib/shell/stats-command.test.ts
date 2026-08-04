import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";

import { portfolioApiClient } from "$lib/api/client";
import type { StatsResponse } from "$lib/api/contracts";

import { createShellState } from "./commands";
import { executeShell } from "./execute";
import {
  createEofFileDescriptor,
  createTerminalFileDescriptor,
} from "./filesystem";
import { asExitCode } from "./schemas";
import type { FileChunk, ProcessIO } from "./types";

const decoder = new TextDecoder();

const fixture: StatsResponse = {
  period: {
    start: "2026-07-28T12:00:00.000Z",
    end: "2026-08-04T12:00:00.000Z",
    label: "last 7 days",
  },
  generatedAt: "2026-08-04T12:00:00.000Z",
  github: {
    status: "ok",
    data: {
      username: "aripiprazole",
      profileUrl: "https://github.com/aripiprazole",
      avatarUrl: "https://avatars.githubusercontent.com/u/1?v=4",
      commits: 42,
      repositories: 6,
      pullRequests: 3,
      issues: 1,
      reviews: 2,
      publicRepositories: 90,
      followers: 100,
    },
  },
  wakatime: {
    status: "ok",
    data: {
      username: "aripiprazole",
      range: "Last 7 Days",
      totalSeconds: 43_200,
      dailyAverageSeconds: 6_171,
      humanReadableTotal: "12 hrs",
      humanReadableDailyAverage: "1 hr 42 mins",
      languages: [{ name: "Rust", seconds: 32_400, percent: 75 }],
      projects: [],
      isUpToDate: true,
    },
  },
  openai: {
    status: "ok",
    data: {
      inputTokens: 1_000_000,
      outputTokens: 250_000,
      cachedInputTokens: 500_000,
      totalTokens: 1_250_000,
      requests: 321,
    },
  },
  chess: {
    status: "ok",
    data: {
      username: "iogabx",
      profileUrl: "https://www.chess.com/member/iogabx",
      avatarUrl: null,
      ratings: {
        rapid: { rating: 939, best: 987 },
        blitz: { rating: 667, best: 763 },
        bullet: null,
        daily: null,
      },
      games: 7,
      wins: 4,
      losses: 2,
      draws: 1,
      byTimeClass: { rapid: 4, blitz: 3, bullet: 0, daily: 0 },
      averageAccuracy: 66.5,
    },
  },
};

const execute = async (source: string) => {
  const stdout: FileChunk[] = [];
  const stderr: FileChunk[] = [];
  const io: ProcessIO = {
    stdin: createEofFileDescriptor(),
    stdout: createTerminalFileDescriptor("stdout", (_stream, chunk) => {
      stdout.push(chunk);
    }),
    stderr: createTerminalFileDescriptor("stderr", (_stream, chunk) => {
      stderr.push(chunk);
    }),
  };
  const result = await executeShell(source, io, createShellState()).completed;
  const text = (chunks: readonly FileChunk[]) =>
    chunks.map((chunk) => decoder.decode(chunk.bytes)).join("");
  return { result, stdout: text(stdout), stderr: text(stderr) };
};

afterEach(() => mock.restore());

describe("stats", () => {
  test("prints the normalized weekly summary", async () => {
    const request = spyOn(portfolioApiClient, "getStats").mockResolvedValue(
      fixture,
    );

    const execution = await execute("stats");

    expect(execution.result.exitCode).toBe(asExitCode(0));
    expect(execution.stdout).toContain("weekly status · last 7 days");
    expect(execution.stdout).toContain("github    42 commits · 6 repos · 3 prs");
    expect(execution.stdout).toContain("wakatime  12 hrs · Rust");
    expect(execution.stdout).toContain("openai    1.3M tokens · 321 requests");
    expect(execution.stdout).toContain("chess     4w 1d 2l · rapid 939");
    expect(execution.stderr).toBe("");
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0]?.[0]).toBeInstanceOf(AbortSignal);
  });

  test("keeps partial provider failures visible without failing the command", async () => {
    spyOn(portfolioApiClient, "getStats").mockResolvedValue({
      ...fixture,
      openai: {
        status: "unavailable",
        reason: "OpenAI usage is not configured",
      },
    });

    const execution = await execute("stats");

    expect(execution.result.exitCode).toBe(asExitCode(0));
    expect(execution.stdout).toContain(
      "openai    [unavailable: OpenAI usage is not configured]",
    );
  });

  test("reports API failures and rejects operands", async () => {
    spyOn(portfolioApiClient, "getStats").mockRejectedValue(
      new Error("too many API requests; try again shortly"),
    );

    const failed = await execute("stats");
    const invalid = await execute("stats now");

    expect(failed.result.exitCode).toBe(asExitCode(1));
    expect(failed.stderr).toBe(
      "stats: too many API requests; try again shortly\n",
    );
    expect(invalid.result.exitCode).toBe(asExitCode(2));
    expect(invalid.stderr).toContain("unsupported argument: now");
  });

  test("is discoverable through man", async () => {
    const execution = await execute("man stats");

    expect(execution.result.exitCode).toBe(asExitCode(0));
    expect(execution.stdout).toContain("STATS(1)");
    expect(execution.stdout).toContain("stats - show weekly activity");
  });
});
