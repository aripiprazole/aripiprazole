import { describe, expect, test } from "bun:test";

import { renderMarkdown } from "./markdown";

describe("renderMarkdown", () => {
  test("renders inline code and links in the same paragraph", () => {
    expect(
      renderMarkdown(
        "run `cat works.md` and [open](https://example.com)",
      ),
    ).toBe(
      '<p>run <code>cat works.md</code> and <a href="https://example.com/" target="_blank" rel="noreferrer noopener">open</a></p>',
    );
  });

  test("escapes code contents without parsing Markdown inside them", () => {
    expect(
      renderMarkdown("`<script>[unsafe](https://example.com)</script>`"),
    ).toBe(
      "<p><code>&lt;script&gt;[unsafe](https://example.com)&lt;/script&gt;</code></p>",
    );
  });

  test("supports matching backtick runs and preserves unmatched delimiters", () => {
    expect(renderMarkdown("``use ` literally``")).toBe(
      "<p><code>use ` literally</code></p>",
    );
    expect(renderMarkdown("`unfinished")).toBe("<p>`unfinished</p>");
  });
});
