import type { z } from "zod";

import {
  apiEnvelopeSchema,
  ChessWeeklySchema,
  GithubProjectSchema,
  GithubWeeklySchema,
  OpenAiWeeklySchema,
  StatsResponseSchema,
  WakatimeWeeklySchema,
  WynncraftProfileSchema,
  type ProviderSlot,
  type StatsResponse,
} from "$lib/api/contracts";
import type { HoverTarget } from "$lib/api/hover-target";

const apiBase = (): string => {
  if (typeof document === "undefined") return "";
  const configured = document
    .querySelector<HTMLMetaElement>('meta[name="portfolio-api-base"]')
    ?.content.trim();
  return configured?.replace(/\/$/u, "") ?? "";
};

const apiUrl = (path: string): string => `${apiBase()}${path}`;

const responseError = async (response: Response): Promise<Error> => {
  try {
    const payload = (await response.json()) as {
      message?: unknown;
      data?: { status?: unknown; reason?: unknown };
    };
    if (typeof payload.message === "string" && payload.message.length > 0) {
      return new Error(payload.message);
    }
    if (
      payload.data?.status === "unavailable" &&
      typeof payload.data.reason === "string"
    ) {
      return new Error(payload.data.reason);
    }
  } catch {
    // Fall through to the stable HTTP error below.
  }
  return new Error(`API returned HTTP ${response.status}`);
};

const requestJson = async <Schema extends z.ZodType>(
  path: string,
  schema: Schema,
  signal?: AbortSignal,
): Promise<z.output<Schema>> => {
  const response = await fetch(apiUrl(path), {
    method: "GET",
    headers: { accept: "application/json" },
    credentials: "omit",
    cache: "no-store",
    signal,
  });
  if (!response.ok) throw await responseError(response);

  const parsed = schema.safeParse(await response.json());
  if (!parsed.success) throw new Error("API returned an unexpected response");
  return parsed.data;
};

export type HoverData =
  | Readonly<{
      kind: "github-project";
      value: ProviderSlot<z.infer<typeof GithubProjectSchema>>;
    }>
  | Readonly<{
      kind: "github";
      value: ProviderSlot<z.infer<typeof GithubWeeklySchema>>;
    }>
  | Readonly<{
      kind: "chess";
      value: ProviderSlot<z.infer<typeof ChessWeeklySchema>>;
    }>
  | Readonly<{
      kind: "wakatime";
      value: ProviderSlot<z.infer<typeof WakatimeWeeklySchema>>;
    }>
  | Readonly<{
      kind: "openai";
      value: ProviderSlot<z.infer<typeof OpenAiWeeklySchema>>;
    }>
  | Readonly<{
      kind: "wynncraft";
      value: ProviderSlot<z.infer<typeof WynncraftProfileSchema>>;
    }>;

export const loadHoverData = async (
  target: HoverTarget,
  signal?: AbortSignal,
): Promise<HoverData> => {
  if (target.kind === "github-project") {
    const response = await requestJson(
      `/api/github/projects/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repository)}`,
      apiEnvelopeSchema(GithubProjectSchema),
      signal,
    );
    return { kind: target.kind, value: response.data };
  }

  const definitions = {
    github: ["/api/github", GithubWeeklySchema],
    chess: ["/api/chess", ChessWeeklySchema],
    wakatime: ["/api/wakatime", WakatimeWeeklySchema],
    openai: ["/api/openai", OpenAiWeeklySchema],
    wynncraft: ["/api/wynncraft", WynncraftProfileSchema],
  } as const;
  const [path, schema] = definitions[target.kind];
  const response = await requestJson(path, apiEnvelopeSchema(schema), signal);
  return { kind: target.kind, value: response.data } as HoverData;
};

export const portfolioApiClient = {
  getStats: async (signal?: AbortSignal): Promise<StatsResponse> =>
    requestJson("/api/stats", StatsResponseSchema, signal),
};
