import { json } from "@sveltejs/kit";

import { loadProvider } from "$lib/server/api-response";
import {
  getChessWeekly,
  getGithubWeekly,
  getOpenAiWeekly,
  getWakatimeWeekly,
  weeklyPeriod,
} from "$lib/server/providers";

export const prerender = false;

export const GET = async (): Promise<Response> => {
  const period = weeklyPeriod();
  const [github, wakatime, openai, chess] = await Promise.all([
    loadProvider(() => getGithubWeekly(period)),
    loadProvider(() => getWakatimeWeekly()),
    loadProvider(() => getOpenAiWeekly(period)),
    loadProvider(() => getChessWeekly(period)),
  ]);

  return json(
    {
      period,
      generatedAt: new Date().toISOString(),
      github: github.slot,
      wakatime: wakatime.slot,
      openai: openai.slot,
      chess: chess.slot,
    },
    {
      headers: {
        "cache-control": "no-store",
        "x-cache": [github.cache, wakatime.cache, openai.cache, chess.cache].join(
          ",",
        ),
      },
    },
  );
};
