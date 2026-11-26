import { json, type Handle } from "@sveltejs/kit";

import { FixedWindowRateLimiter } from "$lib/server/rate-limit";

const apiRateLimiter = new FixedWindowRateLimiter({
  limit: 60,
  windowMs: 60_000,
  maximumClients: 10_000,
});

const rateHeaders = (
  decision: ReturnType<FixedWindowRateLimiter["consume"]>,
  now = Date.now(),
): Record<string, string> => ({
  "ratelimit-limit": String(decision.limit),
  "ratelimit-remaining": String(decision.remaining),
  "ratelimit-reset": String(
    Math.max(0, Math.ceil((decision.resetAt - now) / 1_000)),
  ),
});

export const handle: Handle = async ({ event, resolve }) => {
  if (!event.url.pathname.startsWith("/api/")) return resolve(event);

  if (event.request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET, OPTIONS",
        "access-control-allow-headers": "accept, content-type",
        "access-control-max-age": "86400",
      },
    });
  }

  let client = "unknown";
  try {
    client = event.getClientAddress();
  } catch {
    // Some local adapters cannot resolve a client address. They still share a
    // bounded backend bucket instead of trusting a spoofable forwarding header.
  }

  const decision = apiRateLimiter.consume(client);
  if (!decision.allowed) {
    return json(
      {
        error: "rate_limit_exceeded",
        message: "too many API requests; try again shortly",
      },
      {
        status: 429,
        headers: {
          ...rateHeaders(decision),
          "retry-after": String(decision.retryAfterSeconds),
          "cache-control": "no-store",
          "access-control-allow-origin": "*",
        },
      },
    );
  }

  const response = await resolve(event);
  for (const [name, value] of Object.entries(rateHeaders(decision))) {
    response.headers.set(name, value);
  }
  response.headers.set("access-control-allow-origin", "*");
  response.headers.set("x-content-type-options", "nosniff");
  return response;
};
