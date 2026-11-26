import { loadProvider, providerJson } from "$lib/server/api-response";
import { getOpenAiWeekly, weeklyPeriod } from "$lib/server/providers";

export const prerender = false;

export const GET = async (): Promise<Response> =>
  providerJson(await loadProvider(() => getOpenAiWeekly(weeklyPeriod())));
