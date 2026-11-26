import { describe, expect, test } from "bun:test";

import { hoverTargetForUrl } from "./hover-target";

describe("hoverTargetForUrl", () => {
  test("maps allowlisted profile and project URLs", () => {
    expect(hoverTargetForUrl("https://github.com/aripiprazole")).toEqual({
      kind: "github",
      label: "github · aripiprazole",
    });
    expect(
      hoverTargetForUrl(
        "https://github.com/commune-ai/subspace?tab=readme-ov-file#readme",
      ),
    ).toEqual({
      kind: "github-project",
      owner: "commune-ai",
      repository: "subspace",
      label: "github · commune-ai/subspace",
    });
    expect(
      hoverTargetForUrl("https://github.com/aripiprazole/bupropion"),
    ).toEqual({
      kind: "github-project",
      owner: "aripiprazole",
      repository: "bupropion",
      label: "github · aripiprazole/bupropion",
    });
    expect(hoverTargetForUrl("https://www.chess.com/member/iogabx/")).toEqual({
      kind: "chess",
      label: "chess.com · iogabx",
    });
    expect(hoverTargetForUrl("https://wakatime.com/@aripiprazole")).toEqual({
      kind: "wakatime",
      label: "wakatime · aripiprazole",
    });
    expect(hoverTargetForUrl("https://platform.openai.com/usage")).toEqual({
      kind: "openai",
      label: "openai · api usage",
    });
    expect(
      hoverTargetForUrl("https://wynncraft.com/stats/player/Brexpiprazole"),
    ).toEqual({
      kind: "wynncraft",
      label: "wynncraft · Brexpiprazole",
    });
  });

  test.each([
    "not a URL",
    "https://github.com/unknown-owner/project",
    "https://github.com/aripiprazole/not-in-the-portfolio",
    "https://github.com/aripiprazole/project/issues",
    "https://github.example.com/aripiprazole/project",
    "https://www.chess.com/member/someone-else",
    "https://wakatime.com/@someone-else",
    "https://notopenai.com/usage",
    "https://openai.com.evil.example/usage",
    "https://wynncraft.com/stats/player/SomeoneElse",
  ])("rejects a URL outside the allowlist: %s", (source) => {
    expect(hoverTargetForUrl(source)).toBeNull();
  });
});
