import { describe, expect, test } from "bun:test";

import { filesystem } from "./filesystem";
import {
  analyzeShellInput,
  completeShellInput,
  cycleCompletionIndex,
} from "./input";
import { asAbsolutePath } from "./schemas";

const labels = async (
  source: string,
  cursor = source.length,
): Promise<string[]> =>
  (await completeShellInput(source, cursor, filesystem.initialDirectory)).map(
    (candidate) => candidate.label,
  );

describe("shell input analysis", () => {
  test("classifies commands, arguments, options, strings, pipes, and invalid syntax", () => {
    const tokens = analyzeShellInput('cat "readme.md" | ls -la projects/$bad');

    expect(tokens.map(({ kind, text }) => [kind, text])).toEqual([
      ["command", "cat"],
      ["plain", " "],
      ["string", '"readme.md"'],
      ["plain", " "],
      ["pipe", "|"],
      ["plain", " "],
      ["command", "ls"],
      ["plain", " "],
      ["option", "-la"],
      ["plain", " "],
      ["argument", "projects/"],
      ["invalid", "$"],
      ["argument", "bad"],
    ]);
  });

  test("keeps offsets exact and tolerates incomplete strings and escapes", () => {
    const quoted = analyzeShellInput('cat "README');
    const escaped = analyzeShellInput("cat trailing\\");

    expect(quoted.at(-1)).toEqual({
      kind: "string",
      start: 4,
      end: 11,
      text: '"README',
    });
    expect(escaped.at(-1)).toEqual({
      kind: "invalid",
      start: 12,
      end: 13,
      text: "\\",
    });
  });

  test("distinguishes known command prefixes from unknown commands", () => {
    expect(analyzeShellInput("cu").at(0)?.kind).toBe("command");
    expect(analyzeShellInput("teleport projects").at(0)?.kind).toBe("invalid");
  });

  test("treats adjacent logical AND as a command boundary", () => {
    expect(
      analyzeShellInput("cd projects/ && ls -la").some(
        ({ kind }) => kind === "invalid",
      ),
    ).toBe(false);
    expect(
      analyzeShellInput("cd projects/&&ls -la").map(({ kind, text }) => [
        kind,
        text,
      ]),
    ).toEqual([
      ["command", "cd"],
      ["plain", " "],
      ["argument", "projects/"],
      ["pipe", "&&"],
      ["command", "ls"],
      ["plain", " "],
      ["option", "-la"],
    ]);
  });

  test("keeps quoted and escaped ampersands inside words", () => {
    const tokens = analyzeShellInput(
      String.raw`cat 'single&&quoted' "double&&quoted" escaped\&\&value`,
    );

    expect(tokens.filter(({ kind }) => kind === "pipe")).toEqual([]);
    expect(tokens.filter(({ kind }) => kind === "invalid")).toEqual([]);
    expect(tokens.map(({ text }) => text).join("")).toBe(
      String.raw`cat 'single&&quoted' "double&&quoted" escaped\&\&value`,
    );
  });
});

describe("shell completion", () => {
  test("suggests commands at an empty prompt and after a pipeline", async () => {
    expect(await labels("")).toEqual([
      "cat",
      "cd",
      "clear",
      "curl",
      "exit",
      "ls",
      "man",
      "png",
      "pwd",
      "split",
    ]);
    expect(await labels("cat | c")).toEqual(["cat", "cd", "clear", "curl"]);
  });

  test("suggests commands after logical AND with or without spaces", async () => {
    expect(await labels("cd projects/ && l")).toEqual(["ls"]);
    expect(await labels("cd projects/&&c")).toEqual([
      "cat",
      "cd",
      "clear",
      "curl",
    ]);
  });

  test("uses command metadata for options and stops options after --", async () => {
    const options = await labels("ls -");
    const afterSeparator = await labels("ls -- ");

    expect(options).toEqual(
      expect.arrayContaining(["--all", "--long", "--one-per-line", "-a", "-l"]),
    );
    expect(afterSeparator.some((label) => label.startsWith("-"))).toBe(false);
    expect(afterSeparator).toContain("readme.md");
  });

  test("filters virtual paths by command operand kind", async () => {
    const cat = await labels("cat ");
    const cd = await labels("cd ");
    const ls = await labels("ls ");

    expect(cat).toContain("readme.md");
    expect(cat).not.toContain("projects/");
    expect(cd).toContain("projects/");
    expect(cd).not.toContain("readme.md");
    expect(ls).toEqual(
      expect.arrayContaining(["readme.md", "projects/", "--all"]),
    );
    expect(await labels("png pro")).toEqual(["profile.png"]);
    expect(await labels("png -")).toEqual(["--", "--radius", "-r"]);
  });

  test("completes man pages from the registered command names", async () => {
    expect(await labels("man c")).toEqual(["cat", "cd", "clear", "curl"]);
    expect(await labels("man -")).toEqual(["--"]);
    expect(await labels("man -- ")).toEqual([
      "cat",
      "cd",
      "clear",
      "curl",
      "exit",
      "ls",
      "man",
      "png",
      "pwd",
      "split",
    ]);
    expect(await labels("man cat ")).toEqual([]);
  });

  test("resolves relative, dot, parent, and absolute paths without home completion", async () => {
    expect(await labels("cat writings/gad")).toEqual([
      "writings/gadt-like-types-in-rust.txt",
    ]);
    expect(await labels("cat ./RE")).toEqual(["./readme.md"]);
    expect(await labels("cat ~/con")).toEqual([]);
    expect(await labels("cat /app/RE")).toEqual(["/app/readme.md"]);

    const parent = await completeShellInput(
      "cd ../",
      "cd ../".length,
      asAbsolutePath("/app/projects"),
    );
    expect(parent.map((candidate) => candidate.label)).toContain("../writings/");
  });

  test("preserves the surrounding pipeline when completing at the caret", async () => {
    const source = "cat RE | pwd";
    const candidates = await completeShellInput(
      source,
      6,
      filesystem.initialDirectory,
    );
    const readme = candidates.find(
      (candidate) => candidate.label === "readme.md",
    );

    expect(readme).toEqual({
      kind: "file",
      label: "readme.md",
      draft: "cat readme.md | pwd",
      cursor: 13,
    });
  });

  test("leaves URL values and quoted or escaped words alone", async () => {
    expect(await labels("curl https")).toEqual([]);
    expect(await labels("cat 'RE")).toEqual([]);
    expect(await labels("cat RE\\")).toEqual([]);
  });

  test("sorts candidates deterministically and cycles in both directions", async () => {
    expect(await labels("cd ")).toEqual(await labels("cd "));
    expect(cycleCompletionIndex(null, 3, 1)).toBe(0);
    expect(cycleCompletionIndex(null, 3, -1)).toBe(2);
    expect(cycleCompletionIndex(2, 3, 1)).toBe(0);
    expect(cycleCompletionIndex(0, 3, -1)).toBe(2);
    expect(cycleCompletionIndex(null, 0, 1)).toBeNull();
  });
});
