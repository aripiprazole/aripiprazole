import type {
  ChessWeekly,
  GithubProject,
  GithubWeekly,
  OpenAiWeekly,
  WakatimeWeekly,
  WynncraftProfile,
} from "$lib/api/contracts";

export const stubGithubWeekly = (username: string): GithubWeekly => ({
  username,
  profileUrl: `https://github.com/${encodeURIComponent(username)}`,
  avatarUrl: "https://avatars.githubusercontent.com/u/0?v=4",
  commits: 47,
  repositories: 6,
  pullRequests: 4,
  issues: 2,
  reviews: 5,
  publicRepositories: 89,
  followers: 128,
});

export const stubGithubProject = (
  owner: string,
  repository: string,
): GithubProject => ({
  owner,
  name: repository,
  fullName: `${owner}/${repository}`,
  url: `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}`,
  homepage: null,
  description: "[stub] deterministic repository metadata for local hover development",
  language: "Rust",
  topics: ["portfolio", "stub"],
  stars: 42,
  forks: 7,
  openIssues: 3,
  license: "MIT",
  archived: false,
  fork: false,
  pushedAt: "2026-08-04T12:00:00.000Z",
});

export const stubChessWeekly = (username: string): ChessWeekly => ({
  username,
  profileUrl: `https://www.chess.com/member/${encodeURIComponent(username)}`,
  avatarUrl: null,
  ratings: {
    rapid: { rating: 1_042, best: 1_108 },
    blitz: { rating: 811, best: 894 },
    bullet: { rating: 736, best: 790 },
    daily: null,
  },
  games: 9,
  wins: 5,
  losses: 3,
  draws: 1,
  byTimeClass: { rapid: 5, blitz: 3, bullet: 1, daily: 0 },
  averageAccuracy: 71.4,
});

export const stubWakatimeWeekly = (username: string): WakatimeWeekly => ({
  username,
  range: "Last 7 Days · stub",
  totalSeconds: 45_240,
  dailyAverageSeconds: 6_463,
  humanReadableTotal: "12 hrs 34 mins",
  humanReadableDailyAverage: "1 hr 47 mins",
  languages: [
    { name: "Rust", seconds: 24_701, percent: 54.6 },
    { name: "TypeScript", seconds: 14_386, percent: 31.8 },
    { name: "Nix", seconds: 6_153, percent: 13.6 },
  ],
  projects: [
    { name: "aripiprazole", seconds: 27_596, percent: 61 },
    { name: "take_home", seconds: 17_644, percent: 39 },
  ],
  isUpToDate: true,
});

export const stubOpenAiWeekly = (): OpenAiWeekly => ({
  inputTokens: 1_245_800,
  outputTokens: 318_200,
  cachedInputTokens: 522_400,
  totalTokens: 1_564_000,
  requests: 384,
});

export const stubWynncraftProfile = (
  username: string,
): WynncraftProfile => ({
  username,
  uuid: "00000000-0000-0000-0000-000000000000",
  profileUrl: `https://wynncraft.com/stats/player/${encodeURIComponent(username)}`,
  avatarUrl:
    "https://mc-heads.net/avatar/00000000-0000-0000-0000-000000000000/128",
  online: true,
  server: "WC1",
  rank: "VIP+",
  guild: "Stub Guild",
  firstJoin: "2020-12-02T12:00:00.000Z",
  lastJoin: "2026-08-04T12:00:00.000Z",
  playtimeHours: 742.5,
  totalLevel: 2_136,
  mobsKilled: 184_203,
  chestsFound: 12_481,
  classes: [
    { name: "stub-warrior", type: "warrior", level: 106 },
    { name: "stub-mage", type: "mage", level: 103 },
  ],
});
