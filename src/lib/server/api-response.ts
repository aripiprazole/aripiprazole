import { json } from "@sveltejs/kit";

import type { ProviderSlot } from "$lib/api/contracts";
import type { CachedResult, CacheState } from "$lib/server/cache";
import { ProviderError } from "$lib/server/providers";

export type LoadedProvider<Value> = Readonly<{
  slot: ProviderSlot<Value>;
  cache: CacheState | "none";
  status: number;
}>;

const publicReason = (error: unknown): string => {
  if (error instanceof ProviderError) return error.message;
  return "provider data is temporarily unavailable";
};

export const loadProvider = async <Value>(
  loader: () => Promise<CachedResult<Value>>,
): Promise<LoadedProvider<Value>> => {
  try {
    const result = await loader();
    return {
      slot: { status: "ok", data: result.value },
      cache: result.state,
      status: 200,
    };
  } catch (error: unknown) {
    return {
      slot: { status: "unavailable", reason: publicReason(error) },
      cache: "none",
      status: error instanceof ProviderError ? error.status : 502,
    };
  }
};

export const providerJson = <Value>(loaded: LoadedProvider<Value>): Response =>
  json(
    {
      data: loaded.slot,
      meta: {
        generatedAt: new Date().toISOString(),
        cache: loaded.cache,
      },
      ...(loaded.slot.status === "unavailable"
        ? { message: loaded.slot.reason }
        : {}),
    },
    {
      status: loaded.status,
      headers: {
        "cache-control": "no-store",
        "x-cache": loaded.cache,
      },
    },
  );
