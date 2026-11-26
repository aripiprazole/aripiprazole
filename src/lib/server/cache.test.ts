import { describe, expect, test } from "bun:test";

import { MemoryCache } from "./cache";

describe("MemoryCache", () => {
  test("reports misses and hits until the TTL boundary", async () => {
    let now = 10;
    let loads = 0;
    const cache = new MemoryCache<string>({ now: () => now });
    const load = async () => `value-${++loads}`;

    await expect(cache.getOrLoad("key", 100, 200, load)).resolves.toEqual({
      value: "value-1",
      state: "miss",
    });

    now = 109;
    await expect(cache.getOrLoad("key", 100, 200, load)).resolves.toEqual({
      value: "value-1",
      state: "hit",
    });
    expect(loads).toBe(1);

    now = 110;
    await expect(cache.getOrLoad("key", 100, 200, load)).resolves.toEqual({
      value: "value-2",
      state: "miss",
    });
    expect(loads).toBe(2);
  });

  test("falls back to stale data only inside the stale window", async () => {
    let now = 0;
    const cache = new MemoryCache<string>({ now: () => now });
    const failure = new Error("upstream unavailable");

    await cache.getOrLoad("key", 100, 200, async () => "cached");

    now = 100;
    await expect(
      cache.getOrLoad("key", 100, 200, async () => {
        throw failure;
      }),
    ).resolves.toEqual({ value: "cached", state: "stale" });

    now = 299;
    await expect(
      cache.getOrLoad("key", 100, 200, async () => {
        throw failure;
      }),
    ).resolves.toEqual({ value: "cached", state: "stale" });

    now = 300;
    await expect(
      cache.getOrLoad("key", 100, 200, async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
  });

  test("coalesces concurrent loads for the same key", async () => {
    let release!: (value: string) => void;
    let loads = 0;
    const pending = new Promise<string>((resolve) => {
      release = resolve;
    });
    const cache = new MemoryCache<string>();
    const load = () => {
      loads += 1;
      return pending;
    };

    const first = cache.getOrLoad("shared", 1_000, 1_000, load);
    const second = cache.getOrLoad("shared", 1_000, 1_000, load);

    expect(loads).toBe(1);
    release("loaded once");

    await expect(Promise.all([first, second])).resolves.toEqual([
      { value: "loaded once", state: "miss" },
      { value: "loaded once", state: "hit" },
    ]);
  });

  test("evicts the least recently used entry at the configured bound", async () => {
    const cache = new MemoryCache<string>({ maximumEntries: 2 });
    const loads = new Map<string, number>();
    const read = (key: string) =>
      cache.getOrLoad(key, 10_000, 10_000, async () => {
        const count = (loads.get(key) ?? 0) + 1;
        loads.set(key, count);
        return `${key}-${count}`;
      });

    await read("a");
    await read("b");
    await expect(read("a")).resolves.toMatchObject({ state: "hit" });
    await read("c");

    await expect(read("a")).resolves.toEqual({ value: "a-1", state: "hit" });
    await expect(read("b")).resolves.toEqual({ value: "b-2", state: "miss" });
    expect(loads).toEqual(
      new Map([
        ["a", 1],
        ["b", 2],
        ["c", 1],
      ]),
    );
  });
});
