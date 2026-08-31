/*
 * MarkdownEditorBanners.test — the "saved to disk only" notice
 * (iterate-2026-08-31-shipslog-documents-panel): global, unconditional
 * (unlike the other banners here, it doesn't depend on file content),
 * shown in every phase except loading/load_error.
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { MarkdownEditorBanners } from "./MarkdownEditorBanners";

const BASE = { warnings: [] as string[], hasFrontmatter: false, errorMsg: null };

describe("MarkdownEditorBanners — uncommitted-changes notice", () => {
  it("hidden while loading", () => {
    render(<MarkdownEditorBanners phase="loading" {...BASE} />);
    expect(screen.queryByTestId("md-editor-uncommitted-note")).toBeNull();
  });

  it("hidden on load_error", () => {
    render(<MarkdownEditorBanners phase="load_error" {...BASE} />);
    expect(screen.queryByTestId("md-editor-uncommitted-note")).toBeNull();
  });

  it.each(["editing", "diff", "saving", "conflict"] as const)(
    "shown during phase=%s",
    (phase) => {
      render(<MarkdownEditorBanners phase={phase} {...BASE} />);
      expect(screen.getByTestId("md-editor-uncommitted-note")).toBeTruthy();
    },
  );

  it("renders a real <code> element and a decoded ampersand, not literal markup text", () => {
    // External code review flagged this JSX as a possible literal-text bug
    // (`&amp;`/`<code>` showing up as visible characters). This locks in
    // that it does not: JSX text decodes HTML entities, and <code> compiles
    // to a real element — verified here rather than trusted from memory.
    render(<MarkdownEditorBanners phase="editing" {...BASE} />);
    const note = screen.getByTestId("md-editor-uncommitted-note");
    expect(note.querySelector("code")?.textContent).toBe("/shipwright-iterate");
    expect(note.textContent).toContain("Commit & push");
    expect(note.textContent).not.toContain("&amp;");
  });

  it("shown alongside the other banners, not in place of them", () => {
    render(
      <MarkdownEditorBanners
        phase="conflict"
        warnings={["raw HTML"]}
        hasFrontmatter
        errorMsg={null}
      />,
    );
    expect(screen.getByTestId("md-editor-uncommitted-note")).toBeTruthy();
    expect(screen.getByTestId("md-editor-warn")).toBeTruthy();
    expect(screen.getByTestId("md-editor-frontmatter-note")).toBeTruthy();
    expect(screen.getByTestId("md-editor-conflict")).toBeTruthy();
  });
});
