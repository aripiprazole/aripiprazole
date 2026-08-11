export type RateLimitDecision = Readonly<{
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
  retryAfterSeconds: number;
}>;

type Window = {
  count: number;
  resetAt: number;
  touchedAt: number;
};

export type FixedWindowRateLimiterOptions = Readonly<{
  limit: number;
  windowMs: number;
  maximumClients?: number;
  now?: () => number;
}>;

export class FixedWindowRateLimiter {
  readonly #windows = new Map<string, Window>();
  readonly #limit: number;
  readonly #windowMs: number;
  readonly #maximumClients: number;
  readonly #now: () => number;

  constructor(options: FixedWindowRateLimiterOptions) {
    this.#limit = options.limit;
    this.#windowMs = options.windowMs;
    this.#maximumClients = options.maximumClients ?? 10_000;
    this.#now = options.now ?? Date.now;
  }

  consume(client: string): RateLimitDecision {
    const now = this.#now();
    let window = this.#windows.get(client);

    if (window === undefined || window.resetAt <= now) {
      window = { count: 0, resetAt: now + this.#windowMs, touchedAt: now };
    }

    window.count += 1;
    window.touchedAt = now;
    this.#windows.delete(client);
    this.#windows.set(client, window);
    this.#prune(now);

    const allowed = window.count <= this.#limit;
    return {
      allowed,
      limit: this.#limit,
      remaining: Math.max(0, this.#limit - window.count),
      resetAt: window.resetAt,
      retryAfterSeconds: allowed
        ? 0
        : Math.max(1, Math.ceil((window.resetAt - now) / 1_000)),
    };
  }

  #prune(now: number): void {
    for (const [client, window] of this.#windows) {
      if (window.resetAt <= now) this.#windows.delete(client);
    }

    while (this.#windows.size > this.#maximumClients) {
      const oldest = this.#windows.keys().next().value;
      if (oldest === undefined) return;
      this.#windows.delete(oldest);
    }
  }
}
