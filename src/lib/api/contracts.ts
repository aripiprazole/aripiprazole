import { z } from "zod";

export const PeriodSchema = z
  .object({
    start: z.iso.datetime(),
    end: z.iso.datetime(),
    label: z.string().min(1).max(80),
  })
  .strict();

export type Period = z.infer<typeof PeriodSchema>;

export const GithubWeeklySchema = z
  .object({
    username: z.string().min(1),
    profileUrl: z.url(),
    avatarUrl: z.url(),
    commits: z.number().int().nonnegative(),
    repositories: z.number().int().nonnegative(),
    pullRequests: z.number().int().nonnegative(),
    issues: z.number().int().nonnegative(),
    reviews: z.number().int().nonnegative(),
    publicRepositories: z.number().int().nonnegative(),
    followers: z.number().int().nonnegative(),
  })
  .strict();

export type GithubWeekly = z.infer<typeof GithubWeeklySchema>;

export const GithubProjectSchema = z
  .object({
    owner: z.string().min(1),
    name: z.string().min(1),
    fullName: z.string().min(1),
    url: z.url(),
    homepage: z.url().nullable(),
    description: z.string().nullable(),
    language: z.string().nullable(),
    topics: z.array(z.string()),
    stars: z.number().int().nonnegative(),
    forks: z.number().int().nonnegative(),
    openIssues: z.number().int().nonnegative(),
    license: z.string().nullable(),
    archived: z.boolean(),
    fork: z.boolean(),
    pushedAt: z.iso.datetime(),
  })
  .strict();

export type GithubProject = z.infer<typeof GithubProjectSchema>;

const ChessRatingSchema = z
  .object({
    rating: z.number().int().nonnegative(),
    best: z.number().int().nonnegative(),
  })
  .strict()
  .nullable();

export const ChessWeeklySchema = z
  .object({
    username: z.string().min(1),
    profileUrl: z.url(),
    avatarUrl: z.url().nullable(),
    ratings: z
      .object({
        rapid: ChessRatingSchema,
        blitz: ChessRatingSchema,
        bullet: ChessRatingSchema,
        daily: ChessRatingSchema,
      })
      .strict(),
    games: z.number().int().nonnegative(),
    wins: z.number().int().nonnegative(),
    losses: z.number().int().nonnegative(),
    draws: z.number().int().nonnegative(),
    byTimeClass: z
      .object({
        rapid: z.number().int().nonnegative(),
        blitz: z.number().int().nonnegative(),
        bullet: z.number().int().nonnegative(),
        daily: z.number().int().nonnegative(),
      })
      .strict(),
    averageAccuracy: z.number().min(0).max(100).nullable(),
  })
  .strict();

export type ChessWeekly = z.infer<typeof ChessWeeklySchema>;

export const WakatimeWeeklySchema = z
  .object({
    username: z.string().min(1),
    range: z.string().min(1),
    totalSeconds: z.number().nonnegative(),
    dailyAverageSeconds: z.number().nonnegative(),
    humanReadableTotal: z.string().min(1),
    humanReadableDailyAverage: z.string().min(1),
    languages: z.array(
      z
        .object({
          name: z.string().min(1),
          seconds: z.number().nonnegative(),
          percent: z.number().min(0).max(100),
        })
        .strict(),
    ),
    projects: z.array(
      z
        .object({
          name: z.string().min(1),
          seconds: z.number().nonnegative(),
          percent: z.number().min(0).max(100),
        })
        .strict(),
    ),
    isUpToDate: z.boolean(),
  })
  .strict();

export type WakatimeWeekly = z.infer<typeof WakatimeWeeklySchema>;

export const OpenAiWeeklySchema = z
  .object({
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    cachedInputTokens: z.number().int().nonnegative(),
    totalTokens: z.number().int().nonnegative(),
    requests: z.number().int().nonnegative(),
  })
  .strict();

export type OpenAiWeekly = z.infer<typeof OpenAiWeeklySchema>;

export const WynncraftProfileSchema = z
  .object({
    username: z.string().min(1),
    uuid: z.string().min(1),
    profileUrl: z.url(),
    avatarUrl: z.url(),
    online: z.boolean(),
    server: z.string().nullable(),
    rank: z.string().nullable(),
    guild: z.string().nullable(),
    firstJoin: z.iso.datetime().nullable(),
    lastJoin: z.iso.datetime().nullable(),
    playtimeHours: z.number().nonnegative().nullable(),
    totalLevel: z.number().int().nonnegative().nullable(),
    mobsKilled: z.number().int().nonnegative().nullable(),
    chestsFound: z.number().int().nonnegative().nullable(),
    classes: z.array(
      z
        .object({
          name: z.string().min(1),
          type: z.string().min(1),
          level: z.number().int().nonnegative().nullable(),
        })
        .strict(),
    ),
  })
  .strict();

export type WynncraftProfile = z.infer<typeof WynncraftProfileSchema>;

export const providerSlotSchema = <Schema extends z.ZodType>(schema: Schema) =>
  z.discriminatedUnion("status", [
    z
      .object({
        status: z.literal("ok"),
        data: schema,
      })
      .strict(),
    z
      .object({
        status: z.literal("unavailable"),
        reason: z.string().min(1).max(240),
      })
      .strict(),
  ]);

export type ProviderSlot<Value> =
  | Readonly<{ status: "ok"; data: Value }>
  | Readonly<{ status: "unavailable"; reason: string }>;

export const ApiMetaSchema = z
  .object({
    generatedAt: z.iso.datetime(),
    cache: z.enum(["hit", "miss", "stale", "none"]),
  })
  .strict();

export const apiEnvelopeSchema = <Schema extends z.ZodType>(schema: Schema) =>
  z
    .object({
      data: providerSlotSchema(schema),
      meta: ApiMetaSchema,
    })
    .strict();

export const StatsResponseSchema = z
  .object({
    period: PeriodSchema,
    generatedAt: z.iso.datetime(),
    github: providerSlotSchema(GithubWeeklySchema),
    wakatime: providerSlotSchema(WakatimeWeeklySchema),
    openai: providerSlotSchema(OpenAiWeeklySchema),
    chess: providerSlotSchema(ChessWeeklySchema),
  })
  .strict();

export type StatsResponse = z.infer<typeof StatsResponseSchema>;
