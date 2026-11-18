/*
 * Relative images in rendered markdown (iterate-2026-11-18-smartviewer-md-relative-images).
 * A `![](diagram.svg)` must load through the file route of the document's own folder — not
 * resolve against the app URL (broken placeholder). Covers every image type + both scopes.
 * @covers FR-01.02
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { MarkdownRenderer } from "./MarkdownRenderer";
import { DocumentMarkdown } from "./DocumentMarkdown";

const srcOf = () => screen.getByRole("img").getAttribute("src") ?? "";

describe("MarkdownRenderer — relative images", () => {
  it.each(["svg", "png", "jpg", "jpeg", "gif", "webp"])(
    "serves a sibling .%s through the project file route",
    (ext) => {
      render(<MarkdownRenderer text={`![x](pic.${ext})`} projectId="p1" path="docs/readme.md" />);
      const url = new URL(srcOf(), "http://localhost");
      expect(url.pathname).toMatch(/\/projects\/p1\/file$/);
      expect(url.searchParams.get("path")).toBe(`docs/pic.${ext}`);
    },
  );

  it("resolves ../ and subfolder links against the document's folder", () => {
    render(<MarkdownRenderer text="![x](../img/a%20b.png)" projectId="p1" path="docs/sub/readme.md" />);
    expect(new URL(srcOf(), "http://localhost").searchParams.get("path")).toBe("docs/img/a b.png");
  });

  it("uses the session-file route for an outside-project document", () => {
    render(<MarkdownRenderer text="![x](a.svg)" sessionTaskId="t1" path="C:/notes/readme.md" />);
    const url = new URL(srcOf(), "http://localhost");
    expect(url.pathname).toMatch(/\/tasks\/t1\/session-file$/);
    expect(url.searchParams.get("path")).toBe("C:/notes/a.svg");
  });

  it("leaves absolute URLs untouched", () => {
    render(<MarkdownRenderer text="![x](https://example.com/a.png)" projectId="p1" path="docs/readme.md" />);
    expect(srcOf()).toBe("https://example.com/a.png");
  });

  it("without a resolver (hosts with no file context) keeps the src as written", () => {
    render(<DocumentMarkdown text="![x](pic.png)" />);
    expect(srcOf()).toBe("pic.png");
  });
});
