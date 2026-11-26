import { json } from "@sveltejs/kit";

import { loadProvider, providerJson } from "$lib/server/api-response";
import { getGithubProject } from "$lib/server/providers";

export const prerender = false;

const segment = /^[A-Za-z0-9_.-]{1,100}$/u;

export const GET = async ({ params }): Promise<Response> => {
  if (!segment.test(params.owner) || !segment.test(params.repository)) {
    return json(
      { error: "invalid_repository", message: "invalid GitHub repository" },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }

  return providerJson(
    await loadProvider(() =>
      getGithubProject(params.owner, params.repository),
    ),
  );
};
