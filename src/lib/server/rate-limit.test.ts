import { describe, expect, test } from "bun:test";

import { FixedWindowRateLimiter } from "./rate-limit";

describe("backend FixedWindowRateLimiter", () => {
  test("allows exactly the configured request count before rejecting", () => {
    let now = 10_000;
    const limiter = new FixedWindowRateLimiter({
      limit: 2,
      windowMs: 5_000,
      now: () => now,
    });

    expect(limiter.consume("client")).toEqual({
      allowed: true,
      limit: 2,
      remaining: 1,
      resetAt: 15_000,
      retryAfterSeconds: 0,
    });
    expect(limiter.consume("client")).toEqual({
      allowed: true,
      limit: 2,
      remaining: 0,
      resetAt: 15_000,
      retryAfterSeconds: 0,
    });
    expect(limiter.consume("client")).toEqual({
      allowed: false,
      limit: 2,
      remaining: 0,
      resetAt: 15_000,
      retryAfterSeconds: 5,
    });

    now = 14_001;
    expect(limiter.consume("client").retryAfterSeconds).toBe(1);
  });

  test("tracks clients independently", () => {
    const limiter = new FixedWindowRateLimiter({ limit: 1, windowMs: 1_000 });

    expect(limiter.consume("client-a").allowed).toBe(true);
    expect(limiter.consume("client-a").allowed).toBe(false);
    expect(limiter.consume("client-b")).toMatchObject({
      allowed: true,
      remaining: 0,
    });
    expect(limiter.consume("client-a").allowed).toBe(false);
  });

  test("starts a fresh window exactly at reset time", () => {
    let now = 0;
    const limiter = new FixedWindowRateLimiter({
      limit: 1,
      windowMs: 1_500,
      now: () => now,
    });

    expect(limiter.consume("client")).toMatchObject({
      allowed: true,
      resetAt: 1_500,
    });

    now = 1_499;
    expect(limiter.consume("client")).toMatchObject({
      allowed: false,
      retryAfterSeconds: 1,
    });

    now = 1_500;
    expect(limiter.consume("client")).toEqual({
      allowed: true,
      limit: 1,
      remaining: 0,
      resetAt: 3_000,
      retryAfterSeconds: 0,
    });
  });

  test("bounds tracked clients by most recent use", () => {
    let now = 0;
    const limiter = new FixedWindowRateLimiter({
      limit: 1,
      windowMs: 10_000,
      maximumClients: 2,
      now: () => now,
    });

    limiter.consume("a");
    limiter.consume("b");
    now = 1;
    expect(limiter.consume("a").allowed).toBe(false);
    limiter.consume("c");

    expect(limiter.consume("b").allowed).toBe(true);
  });
});
