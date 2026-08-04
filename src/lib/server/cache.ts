export type CacheState = "hit" | "miss" | "stale";

export type CachedResult<Value> = Readonly<{
  value: Value;
  state: CacheState;
}>;

type CacheEntry<Value> = Readonly<{
  value: Value;
  expiresAt: number;
  staleUntil: number;
}>;

export type MemoryCacheOptions = Readonly<{
  maximumEntries?: number;
  now?: () => number;
}>;

export class MemoryCache<Value> {
  readonly #entries = new Map<string, CacheEntry<Value>>();
  readonly #inflight = new Map<string, Promise<Value>>();
  readonly #maximumEntries: number;
  readonly #now: () => number;

  constructor(options: MemoryCacheOptions = {}) {
    this.#maximumEntries = options.maximumEntries ?? 128;
    this.#now = options.now ?? Date.now;
  }

  async getOrLoad(
    key: string,
    ttlMs: number,
    staleMs: number,
    load: () => Promise<Value>,
  ): Promise<CachedResult<Value>> {
    const now = this.#now();
    const existing = this.#entries.get(key);
    if (existing !== undefined && existing.expiresAt > now) {
      this.#touch(key, existing);
      return { value: existing.value, state: "hit" };
    }

    const pending = this.#inflight.get(key);
    if (pending !== undefined) {
      try {
        return { value: await pending, state: "hit" };
      } catch (error: unknown) {
        if (existing !== undefined && existing.staleUntil > this.#now()) {
          return { value: existing.value, state: "stale" };
        }
        throw error;
      }
    }

    const request = load();
    this.#inflight.set(key, request);

    try {
      const value = await request;
      const loadedAt = this.#now();
      this.#entries.set(key, {
        value,
        expiresAt: loadedAt + ttlMs,
        staleUntil: loadedAt + ttlMs + staleMs,
      });
      this.#prune();
      return { value, state: "miss" };
    } catch (error: unknown) {
      if (existing !== undefined && existing.staleUntil > this.#now()) {
        this.#touch(key, existing);
        return { value: existing.value, state: "stale" };
      }
      throw error;
    } finally {
      this.#inflight.delete(key);
    }
  }

  clear(): void {
    this.#entries.clear();
    this.#inflight.clear();
  }

  #touch(key: string, entry: CacheEntry<Value>): void {
    this.#entries.delete(key);
    this.#entries.set(key, entry);
  }

  #prune(): void {
    const now = this.#now();
    for (const [key, entry] of this.#entries) {
      if (entry.staleUntil <= now) this.#entries.delete(key);
    }

    while (this.#entries.size > this.#maximumEntries) {
      const oldest = this.#entries.keys().next().value;
      if (oldest === undefined) return;
      this.#entries.delete(oldest);
    }
  }
}
