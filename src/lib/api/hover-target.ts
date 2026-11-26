import { isPortfolioGithubRepository } from "$lib/api/github-projects";

export type HoverTarget =
  | Readonly<{
      kind: "github-project";
      owner: string;
      repository: string;
      label: string;
    }>
  | Readonly<{
      kind: "github" | "chess" | "wakatime" | "openai" | "wynncraft";
      label: string;
    }>;

export const hoverTargetForUrl = (source: string): HoverTarget | null => {
  let url: URL;
  try {
    url = new URL(source);
  } catch {
    return null;
  }
  const segments = url.pathname.split("/").filter(Boolean);
  const host = url.hostname.toLowerCase();

  if (host === "github.com") {
    const [owner, repository] = segments;
    if (owner?.toLowerCase() === "aripiprazole" && repository === undefined) {
      return { kind: "github", label: "github · aripiprazole" };
    }
    if (
      owner !== undefined &&
      repository !== undefined &&
      segments.length === 2 &&
      isPortfolioGithubRepository(owner, repository)
    ) {
      return {
        kind: "github-project",
        owner,
        repository,
        label: `github · ${owner}/${repository}`,
      };
    }
  }

  if (
    (host === "chess.com" || host === "www.chess.com") &&
    segments[0]?.toLowerCase() === "member" &&
    segments[1]?.toLowerCase() === "iogabx"
  ) {
    return { kind: "chess", label: "chess.com · iogabx" };
  }

  if (
    (host === "wakatime.com" || host === "www.wakatime.com") &&
    ["@aripiprazole", "aripiprazole"].includes(
      segments[0]?.toLowerCase() ?? "",
    )
  ) {
    return { kind: "wakatime", label: "wakatime · aripiprazole" };
  }

  if (
    (host === "wynncraft.com" || host === "www.wynncraft.com") &&
    segments.some((segment) => segment.toLowerCase() === "brexpiprazole")
  ) {
    return { kind: "wynncraft", label: "wynncraft · Brexpiprazole" };
  }

  if (host === "openai.com" || host.endsWith(".openai.com")) {
    return { kind: "openai", label: "openai · api usage" };
  }

  return null;
};
