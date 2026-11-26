import { z } from "zod";

import type {
  ChessWeekly,
  GithubProject,
  GithubWeekly,
  OpenAiWeekly,
  Period,
  WakatimeWeekly,
  WynncraftProfile,
} from "$lib/api/contracts";
import { isPortfolioGithubRepository } from "$lib/api/github-projects";
import { MemoryCache, type CachedResult } from "$lib/server/cache";
import {
  stubChessWeekly,
  stubGithubProject,
  stubGithubWeekly,
  stubOpenAiWeekly,
  stubWakatimeWeekly,
  stubWynncraftProfile,
} from "$lib/server/provider-stubs";

const DAY_MS = 86_400_000;
const PROVIDER_TIMEOUT_MS = 8_000;
const STANDARD_TTL_MS = 10 * 60_000;
const STANDARD_STALE_MS = 30 * 60_000;
const WYNNCRAFT_TTL_MS = 2 * 60_000;

const providerStubsEnabled = (): boolean =>
  process.env.PORTFOLIO_API_STUB?.trim() === "1";

const providerCacheKey = (key: string, stubbed: boolean): string =>
  `${stubbed ? "stub" : "live"}:${key}`;

export class ProviderError extends Error {
  readonly status: number;

  constructor(message: string, status = 502) {
    super(message);
    this.name = "ProviderError";
    this.status = status;
  }
}

const requiredEnvironment = (name: string): string => {
  const value = process.env[name]?.trim();
  if (value === undefined || value.length === 0) {
    throw new ProviderError(`${name} is not configured`, 503);
  }
  return value;
};

const providerFetch = async <Schema extends z.ZodType>(
  provider: string,
  url: URL | string,
  schema: Schema,
  init: RequestInit = {},
): Promise<z.output<Schema>> => {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: {
        accept: "application/json",
        ...init.headers,
      },
      redirect: "error",
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    });
  } catch {
    throw new ProviderError(`${provider} request failed`);
  }

  if (!response.ok) {
    if (response.status === 404) {
      throw new ProviderError(`${provider} profile was not found`, 404);
    }
    if (response.status === 429) {
      throw new ProviderError(`${provider} is temporarily rate limited`, 503);
    }
    throw new ProviderError(`${provider} returned HTTP ${response.status}`);
  }

  try {
    return schema.parse(await response.json());
  } catch {
    throw new ProviderError(`${provider} returned an unexpected response`);
  }
};

export const weeklyPeriod = (now = new Date()): Period => ({
  start: new Date(now.getTime() - 7 * DAY_MS).toISOString(),
  end: now.toISOString(),
  label: providerStubsEnabled() ? "last 7 days · stub" : "last 7 days",
});

const githubHeaders = (): HeadersInit => {
  const token = process.env.GITHUB_TOKEN?.trim();
  return {
    accept: "application/vnd.github+json",
    "user-agent": "gabx.io portfolio stats",
    "x-github-api-version": "2026-03-10",
    ...(token === undefined || token.length === 0
      ? {}
      : { authorization: `Bearer ${token}` }),
  };
};

const GithubProfileUpstreamSchema = z
  .object({
    login: z.string(),
    html_url: z.url(),
    avatar_url: z.url(),
    public_repos: z.number(),
    followers: z.number(),
  })
  .passthrough();

const GithubContributionsUpstreamSchema = z
  .object({
    data: z
      .object({
        user: z
          .object({
            contributionsCollection: z
              .object({
                totalCommitContributions: z.number(),
                totalRepositoriesWithContributedCommits: z.number(),
                totalPullRequestContributions: z.number(),
                totalIssueContributions: z.number(),
                totalPullRequestReviewContributions: z.number(),
              })
              .passthrough(),
          })
          .nullable(),
      })
      .passthrough(),
    errors: z.array(z.object({ message: z.string() }).passthrough()).optional(),
  })
  .passthrough();

const GithubRepositoryUpstreamSchema = z
  .object({
    owner: z.object({ login: z.string() }).passthrough(),
    name: z.string(),
    full_name: z.string(),
    html_url: z.url(),
    homepage: z.string().nullable(),
    description: z.string().nullable(),
    language: z.string().nullable(),
    topics: z.array(z.string()).default([]),
    stargazers_count: z.number(),
    forks_count: z.number(),
    open_issues_count: z.number(),
    license: z.object({ spdx_id: z.string().nullable() }).nullable(),
    archived: z.boolean(),
    fork: z.boolean(),
    pushed_at: z.iso.datetime(),
  })
  .passthrough();

const githubWeeklyCache = new MemoryCache<GithubWeekly>();
const githubProjectCache = new MemoryCache<GithubProject>();

export const getGithubWeekly = async (
  period: Period,
): Promise<CachedResult<GithubWeekly>> => {
  const username = process.env.GITHUB_USERNAME?.trim() || "aripiprazole";
  const stubbed = providerStubsEnabled();
  const key = providerCacheKey(
    `github:${username}:${period.start.slice(0, 10)}`,
    stubbed,
  );

  return githubWeeklyCache.getOrLoad(
    key,
    STANDARD_TTL_MS,
    STANDARD_STALE_MS,
    async () => {
      if (stubbed) return stubGithubWeekly(username);

      const token = requiredEnvironment("GITHUB_TOKEN");
      const query = `query WeeklyGithub($login: String!, $from: DateTime!, $to: DateTime!) {
        user(login: $login) {
          contributionsCollection(from: $from, to: $to) {
            totalCommitContributions
            totalRepositoriesWithContributedCommits
            totalPullRequestContributions
            totalIssueContributions
            totalPullRequestReviewContributions
          }
        }
      }`;

      const [profile, contributions] = await Promise.all([
        providerFetch(
          "GitHub",
          `https://api.github.com/users/${encodeURIComponent(username)}`,
          GithubProfileUpstreamSchema,
          { headers: githubHeaders() },
        ),
        providerFetch(
          "GitHub",
          "https://api.github.com/graphql",
          GithubContributionsUpstreamSchema,
          {
            method: "POST",
            headers: {
              ...githubHeaders(),
              authorization: `Bearer ${token}`,
              "content-type": "application/json",
            },
            body: JSON.stringify({
              query,
              variables: {
                login: username,
                from: period.start,
                to: period.end,
              },
            }),
          },
        ),
      ]);

      if (contributions.errors?.length) {
        throw new ProviderError("GitHub could not calculate contributions");
      }
      const totals = contributions.data.user?.contributionsCollection;
      if (totals === undefined) {
        throw new ProviderError("GitHub user was not found", 404);
      }

      return {
        username: profile.login,
        profileUrl: profile.html_url,
        avatarUrl: profile.avatar_url,
        commits: totals.totalCommitContributions,
        repositories: totals.totalRepositoriesWithContributedCommits,
        pullRequests: totals.totalPullRequestContributions,
        issues: totals.totalIssueContributions,
        reviews: totals.totalPullRequestReviewContributions,
        publicRepositories: profile.public_repos,
        followers: profile.followers,
      };
    },
  );
};

export const getGithubProject = async (
  owner: string,
  repository: string,
): Promise<CachedResult<GithubProject>> => {
  const key = `${owner.toLowerCase()}/${repository.toLowerCase()}`;
  if (!isPortfolioGithubRepository(owner, repository)) {
    throw new ProviderError("GitHub repository is not in the portfolio", 404);
  }

  const stubbed = providerStubsEnabled();
  const cacheKey = providerCacheKey(`github-project:${key}`, stubbed);
  return githubProjectCache.getOrLoad(
    cacheKey,
    STANDARD_TTL_MS,
    STANDARD_STALE_MS,
    async () => {
      if (stubbed) return stubGithubProject(owner, repository);

      const value = await providerFetch(
        "GitHub",
        `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}`,
        GithubRepositoryUpstreamSchema,
        { headers: githubHeaders() },
      );
      const homepage = value.homepage?.trim();

      return {
        owner: value.owner.login,
        name: value.name,
        fullName: value.full_name,
        url: value.html_url,
        homepage:
          homepage !== undefined && z.url().safeParse(homepage).success
            ? homepage
            : null,
        description: value.description,
        language: value.language,
        topics: value.topics,
        stars: value.stargazers_count,
        forks: value.forks_count,
        openIssues: value.open_issues_count,
        license: value.license?.spdx_id ?? null,
        archived: value.archived,
        fork: value.fork,
        pushedAt: value.pushed_at,
      };
    },
  );
};

const ChessProfileUpstreamSchema = z
  .object({
    username: z.string(),
    url: z.url(),
    avatar: z.url().optional(),
  })
  .passthrough();

const ChessStatsUpstreamSchema = z
  .object({
    chess_rapid: z.unknown().optional(),
    chess_blitz: z.unknown().optional(),
    chess_bullet: z.unknown().optional(),
    chess_daily: z.unknown().optional(),
  })
  .passthrough();

const ChessRatingUpstreamSchema = z
  .object({
    last: z.object({ rating: z.number() }).passthrough(),
    best: z.object({ rating: z.number() }).passthrough(),
  })
  .passthrough();

const ChessGameUpstreamSchema = z
  .object({
    end_time: z.number(),
    time_class: z.string(),
    white: z
      .object({ username: z.string(), result: z.string() })
      .passthrough(),
    black: z
      .object({ username: z.string(), result: z.string() })
      .passthrough(),
    accuracies: z
      .object({ white: z.number().optional(), black: z.number().optional() })
      .optional(),
  })
  .passthrough();

const ChessGamesUpstreamSchema = z
  .object({ games: z.array(ChessGameUpstreamSchema) })
  .passthrough();

const chessCache = new MemoryCache<ChessWeekly>();

const chessHeaders = (): HeadersInit => ({
  "user-agent": "gabx.io portfolio stats (contact: you@gabx.io)",
});

const chessRating = (value: unknown): { rating: number; best: number } | null => {
  const parsed = ChessRatingUpstreamSchema.safeParse(value);
  return parsed.success
    ? { rating: parsed.data.last.rating, best: parsed.data.best.rating }
    : null;
};

const monthKeysForPeriod = (period: Period): readonly string[] => {
  const start = new Date(period.start);
  const end = new Date(period.end);
  const keys = new Set<string>();
  const cursor = new Date(
    Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1),
  );
  const final = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1));

  while (cursor <= final) {
    keys.add(
      `${cursor.getUTCFullYear()}/${String(cursor.getUTCMonth() + 1).padStart(2, "0")}`,
    );
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return [...keys];
};

const drawResults = new Set([
  "agreed",
  "stalemate",
  "insufficient",
  "repetition",
  "timevsinsufficient",
  "50move",
]);

export const getChessWeekly = async (
  period: Period,
): Promise<CachedResult<ChessWeekly>> => {
  const username = process.env.CHESS_USERNAME?.trim() || "iogabx";
  const stubbed = providerStubsEnabled();
  const key = providerCacheKey(
    `chess:${username.toLowerCase()}:${period.start.slice(0, 10)}`,
    stubbed,
  );

  return chessCache.getOrLoad(
    key,
    STANDARD_TTL_MS,
    STANDARD_STALE_MS,
    async () => {
      if (stubbed) return stubChessWeekly(username);

      const base = `https://api.chess.com/pub/player/${encodeURIComponent(username.toLowerCase())}`;
      const profile = await providerFetch(
        "Chess.com",
        base,
        ChessProfileUpstreamSchema,
        { headers: chessHeaders() },
      );
      const stats = await providerFetch(
        "Chess.com",
        `${base}/stats`,
        ChessStatsUpstreamSchema,
        { headers: chessHeaders() },
      );

      const games: z.output<typeof ChessGameUpstreamSchema>[] = [];
      for (const month of monthKeysForPeriod(period)) {
        const archive = await providerFetch(
          "Chess.com",
          `${base}/games/${month}`,
          ChessGamesUpstreamSchema,
          { headers: chessHeaders() },
        );
        games.push(...archive.games);
      }

      const startSeconds = Date.parse(period.start) / 1_000;
      const endSeconds = Date.parse(period.end) / 1_000;
      const weeklyGames = games.filter(
        (game) => game.end_time >= startSeconds && game.end_time < endSeconds,
      );
      const byTimeClass = { rapid: 0, blitz: 0, bullet: 0, daily: 0 };
      const result = { wins: 0, losses: 0, draws: 0 };
      const accuracies: number[] = [];

      for (const game of weeklyGames) {
        const isWhite =
          game.white.username.toLowerCase() === username.toLowerCase();
        const player = isWhite ? game.white : game.black;
        if (player.result === "win") result.wins += 1;
        else if (drawResults.has(player.result)) result.draws += 1;
        else result.losses += 1;

        if (game.time_class in byTimeClass) {
          byTimeClass[game.time_class as keyof typeof byTimeClass] += 1;
        }
        const accuracy = game.accuracies?.[isWhite ? "white" : "black"];
        if (accuracy !== undefined) accuracies.push(accuracy);
      }

      return {
        username: profile.username,
        profileUrl: profile.url,
        avatarUrl: profile.avatar ?? null,
        ratings: {
          rapid: chessRating(stats.chess_rapid),
          blitz: chessRating(stats.chess_blitz),
          bullet: chessRating(stats.chess_bullet),
          daily: chessRating(stats.chess_daily),
        },
        games: weeklyGames.length,
        ...result,
        byTimeClass,
        averageAccuracy:
          accuracies.length === 0
            ? null
            : accuracies.reduce((total, value) => total + value, 0) /
              accuracies.length,
      };
    },
  );
};

const WakatimeBreakdownUpstreamSchema = z
  .object({
    name: z.string(),
    total_seconds: z.number(),
    percent: z.number(),
  })
  .passthrough();

const WakatimeUpstreamSchema = z
  .object({
    data: z
      .object({
        username: z.string().optional(),
        human_readable_range: z.string(),
        total_seconds: z.number(),
        daily_average: z.number(),
        human_readable_total: z.string(),
        human_readable_daily_average: z.string(),
        languages: z.array(WakatimeBreakdownUpstreamSchema).default([]),
        projects: z.array(WakatimeBreakdownUpstreamSchema).default([]),
        is_up_to_date: z.boolean().default(true),
      })
      .passthrough(),
  })
  .passthrough();

const wakatimeCache = new MemoryCache<WakatimeWeekly>();

const wakatimeRequest = (): Readonly<{
  url: string;
  headers: HeadersInit;
  username: string;
}> => {
  const shareUrl = process.env.WAKATIME_SHARE_URL?.trim();
  const username = process.env.WAKATIME_USERNAME?.trim() || "aripiprazole";
  if (shareUrl !== undefined && shareUrl.length > 0) {
    const parsed = new URL(shareUrl);
    if (
      parsed.protocol !== "https:" ||
      !["wakatime.com", "api.wakatime.com"].includes(parsed.hostname)
    ) {
      throw new ProviderError("WAKATIME_SHARE_URL must be a WakaTime HTTPS URL", 503);
    }
    return { url: parsed.href, headers: {}, username };
  }

  const key = requiredEnvironment("WAKATIME_API_KEY");
  return {
    url: "https://api.wakatime.com/api/v1/users/current/stats/last_7_days",
    headers: { authorization: `Basic ${Buffer.from(key).toString("base64")}` },
    username,
  };
};

export const getWakatimeWeekly = async (): Promise<
  CachedResult<WakatimeWeekly>
> => {
  const stubbed = providerStubsEnabled();
  return wakatimeCache.getOrLoad(
    providerCacheKey("wakatime:weekly", stubbed),
    STANDARD_TTL_MS,
    STANDARD_STALE_MS,
    async () => {
      const username = process.env.WAKATIME_USERNAME?.trim() || "aripiprazole";
      if (stubbed) return stubWakatimeWeekly(username);

      const request = wakatimeRequest();
      const response = await providerFetch(
        "WakaTime",
        request.url,
        WakatimeUpstreamSchema,
        { headers: request.headers },
      );
      if (!response.data.is_up_to_date) {
        throw new ProviderError("WakaTime is refreshing weekly statistics", 503);
      }
      const breakdown = (
        item: z.output<typeof WakatimeBreakdownUpstreamSchema>,
      ) => ({
        name: item.name,
        seconds: item.total_seconds,
        percent: item.percent,
      });

      return {
        username: response.data.username ?? request.username,
        range: response.data.human_readable_range,
        totalSeconds: response.data.total_seconds,
        dailyAverageSeconds: response.data.daily_average,
        humanReadableTotal: response.data.human_readable_total,
        humanReadableDailyAverage:
          response.data.human_readable_daily_average,
        languages: response.data.languages.slice(0, 5).map(breakdown),
        projects: response.data.projects.slice(0, 5).map(breakdown),
        isUpToDate: response.data.is_up_to_date,
      };
    },
  );
};

const OpenAiUsageUpstreamSchema = z
  .object({
    data: z.array(
      z
        .object({
          results: z.array(
            z
              .object({
                input_tokens: z.number().default(0),
                output_tokens: z.number().default(0),
                input_cached_tokens: z.number().default(0),
                num_model_requests: z.number().default(0),
              })
              .passthrough(),
          ),
        })
        .passthrough(),
    ),
    has_more: z.boolean().default(false),
    next_page: z.string().nullable().default(null),
  })
  .passthrough();

const openAiCache = new MemoryCache<OpenAiWeekly>();

export const getOpenAiWeekly = async (
  period: Period,
): Promise<CachedResult<OpenAiWeekly>> => {
  const stubbed = providerStubsEnabled();
  return openAiCache.getOrLoad(
    providerCacheKey(`openai:${period.start.slice(0, 10)}`, stubbed),
    STANDARD_TTL_MS,
    STANDARD_STALE_MS,
    async () => {
      if (stubbed) return stubOpenAiWeekly();

      const key = requiredEnvironment("OPENAI_ADMIN_KEY");
      const projectId = requiredEnvironment("OPENAI_PROJECT_ID");
      const totals = {
        inputTokens: 0,
        outputTokens: 0,
        cachedInputTokens: 0,
        requests: 0,
      };
      let page: string | null = null;

      for (let pageCount = 0; pageCount < 5; pageCount += 1) {
        const url = new URL(
          "https://api.openai.com/v1/organization/usage/completions",
        );
        url.searchParams.set(
          "start_time",
          String(Math.floor(Date.parse(period.start) / 1_000)),
        );
        url.searchParams.set(
          "end_time",
          String(Math.floor(Date.parse(period.end) / 1_000)),
        );
        url.searchParams.set("bucket_width", "1d");
        url.searchParams.set("limit", "7");
        url.searchParams.append("project_ids", projectId);
        if (page !== null) url.searchParams.set("page", page);

        const response = await providerFetch(
          "OpenAI",
          url,
          OpenAiUsageUpstreamSchema,
          { headers: { authorization: `Bearer ${key}` } },
        );
        for (const bucket of response.data) {
          for (const result of bucket.results) {
            totals.inputTokens += result.input_tokens;
            totals.outputTokens += result.output_tokens;
            totals.cachedInputTokens += result.input_cached_tokens;
            totals.requests += result.num_model_requests;
          }
        }

        page = response.next_page;
        if (!response.has_more || page === null) break;
      }

      return {
        ...totals,
        totalTokens: totals.inputTokens + totals.outputTokens,
      };
    },
  );
};

const WynncraftPlayerUpstreamSchema = z
  .object({
    username: z.string(),
    uuid: z.string(),
    online: z.boolean().default(false),
    server: z.string().nullable().optional(),
    rank: z.string().nullable().optional(),
    supportRank: z.string().nullable().optional(),
    firstJoin: z.iso.datetime().nullable().optional(),
    lastJoin: z.iso.datetime().nullable().optional(),
    playtime: z.number().nullable().optional(),
    guild: z
      .object({ name: z.string().optional() })
      .nullable()
      .optional(),
    globalData: z
      .object({
        totalLevel: z.number().optional(),
        mobsKilled: z.number().optional(),
        chestsFound: z.number().optional(),
      })
      .passthrough()
      .optional(),
    characters: z
      .record(
        z.string(),
        z
          .object({
            type: z.string(),
            level: z.number().optional(),
          })
          .passthrough(),
      )
      .optional(),
  })
  .passthrough();

const wynncraftCache = new MemoryCache<WynncraftProfile>();

export const getWynncraftProfile = async (): Promise<
  CachedResult<WynncraftProfile>
> => {
  const username = process.env.WYNNCRAFT_USERNAME?.trim() || "Brexpiprazole";
  const stubbed = providerStubsEnabled();
  return wynncraftCache.getOrLoad(
    providerCacheKey(`wynncraft:${username.toLowerCase()}`, stubbed),
    WYNNCRAFT_TTL_MS,
    STANDARD_STALE_MS,
    async () => {
      if (stubbed) return stubWynncraftProfile(username);

      const token = process.env.WYNNCRAFT_TOKEN?.trim();
      const player = await providerFetch(
        "Wynncraft",
        `https://api.wynncraft.com/v3/player/${encodeURIComponent(username)}?fullResult`,
        WynncraftPlayerUpstreamSchema,
        {
          headers:
            token === undefined || token.length === 0
              ? {}
              : { authorization: `Bearer ${token}` },
        },
      );

      return {
        username: player.username,
        uuid: player.uuid,
        profileUrl: `https://wynncraft.com/stats/player/${encodeURIComponent(player.username)}`,
        avatarUrl: `https://mc-heads.net/avatar/${encodeURIComponent(player.uuid)}/128`,
        online: player.online,
        server: player.server ?? null,
        rank: player.supportRank ?? player.rank ?? null,
        guild: player.guild?.name ?? null,
        firstJoin: player.firstJoin ?? null,
        lastJoin: player.lastJoin ?? null,
        playtimeHours: player.playtime ?? null,
        totalLevel: player.globalData?.totalLevel ?? null,
        mobsKilled: player.globalData?.mobsKilled ?? null,
        chestsFound: player.globalData?.chestsFound ?? null,
        classes: Object.entries(player.characters ?? {}).map(([name, value]) => ({
          name,
          type: value.type,
          level: value.level ?? null,
        })),
      };
    },
  );
};
