import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";

import {
  ChessWeeklySchema,
  GithubProjectSchema,
  GithubWeeklySchema,
  OpenAiWeeklySchema,
  WakatimeWeeklySchema,
  WynncraftProfileSchema,
} from "$lib/api/contracts";

type Providers = typeof import("./providers");

const originalFetch = globalThis.fetch;
const originalStubMode = process.env.PORTFOLIO_API_STUB;
let providers: Providers;
let fetchCalls = 0;

const expectCachedTwice = async (
  read: () => Promise<{ value: unknown; state: string }>,
  parse: (value: unknown) => unknown,
) => {
  const first = await read();
  expect(first.state).toBe("miss");
  expect(() => parse(first.value)).not.toThrow();

  const second = await read();
  expect(second).toEqual({ value: first.value, state: "hit" });
};

beforeAll(async () => {
  process.env.PORTFOLIO_API_STUB = "1";
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    throw new Error("stub providers must not call fetch");
  }) as unknown as typeof fetch;
  providers = await import("./providers");
});

afterEach(() => {
  expect(fetchCalls).toBe(0);
});

afterAll(() => {
  globalThis.fetch = originalFetch;
  if (originalStubMode === undefined) {
    delete process.env.PORTFOLIO_API_STUB;
  } else {
    process.env.PORTFOLIO_API_STUB = originalStubMode;
  }
});

describe("provider stub mode", () => {
  test("serves every provider from the in-memory cache", async () => {
    const period = providers.weeklyPeriod(
      new Date("2037-04-12T12:00:00.000Z"),
    );
    expect(period.label).toBe("last 7 days · stub");

    await expectCachedTwice(
      () => providers.getGithubWeekly(period),
      (value) => GithubWeeklySchema.parse(value),
    );
    await expectCachedTwice(
      () => providers.getGithubProject("aripiprazole", "bupropion"),
      (value) => GithubProjectSchema.parse(value),
    );
    await expectCachedTwice(
      () => providers.getChessWeekly(period),
      (value) => ChessWeeklySchema.parse(value),
    );
    await expectCachedTwice(
      () => providers.getWakatimeWeekly(),
      (value) => WakatimeWeeklySchema.parse(value),
    );
    await expectCachedTwice(
      () => providers.getOpenAiWeekly(period),
      (value) => OpenAiWeeklySchema.parse(value),
    );
    await expectCachedTwice(
      () => providers.getWynncraftProfile(),
      (value) => WynncraftProfileSchema.parse(value),
    );
  });

  test("keeps the exact GitHub portfolio allowlist in stub mode", async () => {
    await expect(
      providers.getGithubProject("aripiprazole", "not-in-the-portfolio"),
    ).rejects.toMatchObject({
      name: "ProviderError",
      status: 404,
      message: "GitHub repository is not in the portfolio",
    });
  });
});
