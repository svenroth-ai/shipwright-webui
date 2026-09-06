/*
 * Markdown table cells default to browser `vertical-align: middle` unless
 * overridden — for a row mixing short cells with a wrapped multi-line cell,
 * centering reads as visually broken (short cells float mid-row instead of
 * aligning with the top of the wrapped text).
 *
 * Scoped to `.smart-viewer-markdown` (the SmartViewer document pane), NOT the
 * base `.markdown-body table` rule — that base rule is shared by ~5 other
 * DocumentMarkdown consumers (chat transcript bubbles, OrgDocViewerModal,
 * ComplianceDetailModal, MissionArtifactBody, MissionSlice2Details) that were
 * never asked for this change. Mirrors the existing
 * `.smart-viewer-markdown .markdown-body table` scoping pattern two rules
 * above it in index.css. Cheap CSS-rule ratchet; behavioural proof is the
 * SmartViewer rendering itself.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("SmartViewer markdown table cells are top-aligned", () => {
  it("index.css scopes vertical-align: top to .smart-viewer-markdown table th/td", () => {
    const css = readFileSync(join(__dirname, "../index.css"), "utf-8");
    const match = css.match(
      /\.smart-viewer-markdown \.markdown-body table th,\s*\n\.smart-viewer-markdown \.markdown-body table td\s*\{([^}]*)\}/,
    );
    expect(
      match,
      "expected the .smart-viewer-markdown .markdown-body table th/td rule to exist",
    ).toBeTruthy();
    expect(match![1]).toMatch(/vertical-align:\s*top/);
  });

  it("does NOT set vertical-align on the shared (unscoped) .markdown-body table th/td rule", () => {
    const css = readFileSync(join(__dirname, "../index.css"), "utf-8");
    const match = css.match(
      /(?<!\.smart-viewer-markdown )\.markdown-body table th,\s*\n\.markdown-body table td\s*\{([^}]*)\}/,
    );
    expect(match, "expected the shared .markdown-body table th/td rule to exist").toBeTruthy();
    expect(
      match![1],
      "vertical-align must stay off the shared rule — it leaks into non-SmartViewer DocumentMarkdown consumers (transcript bubbles, OrgDocViewerModal, ComplianceDetailModal, MissionArtifactBody, MissionSlice2Details)",
    ).not.toMatch(/vertical-align/);
  });
});
