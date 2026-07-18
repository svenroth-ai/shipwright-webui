/*
 * LaunchPayloadBlock.test.tsx — render-rule guard for the three branches
 * of `prepareLaunchPayload`. The component is a thin renderer over the
 * decision helper; tests focus on (a) right branch fires, (b) cleaned
 * text reaches the DOM, (c) github placeholder uses the verbatim string.
 *
 * iterate-2026-05-20-triage-launch-surface-webui external review
 * MED #3 / MED #4 / MED #11 fences:
 *   - rendered text === clipboard-source text (single helper output)
 *   - github placeholder triggers on CLEANED-empty, not raw-empty
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { LaunchPayloadBlock } from "./LaunchPayloadBlock";
import { GITHUB_PLACEHOLDER_TEXT } from "../../lib/launchPayload";
import type { TriageItem } from "../../lib/triageApi";

function makeItem(partial: Partial<TriageItem> = {}): TriageItem {
  return {
    id: "trg-test1234",
    ts: "2026-05-20T08:00:00Z",
    originalTs: "2026-05-20T08:00:00Z",
    source: "phaseQuality",
    severity: "medium",
    kind: "bug",
    title: "Test",
    detail: "Test detail",
    evidencePath: null,
    runId: null,
    commit: null,
    dedupKey: null,
    status: "triage",
    suggestedPriority: "P2",
    suggestedDomain: "engineering",
    statusBy: null,
    statusReason: null,
    promotedTaskId: null,
    ...partial,
  };
}

describe("LaunchPayloadBlock", () => {
  // @covers FR-01.30
  it("renders the cleaned payload inside <pre><code>", () => {
    const payload = "/iterate fix something\n\nhttps://example.test";
    const item = makeItem({ source: "phaseQuality", launchPayload: payload });
    render(<LaunchPayloadBlock item={item} />);

    const block = screen.getByTestId("triage-launch-payload-content");
    expect(block.tagName).toBe("PRE");
    expect(block.textContent).toBe(payload);
  });

  // @covers FR-01.30
  it("strips control chars from the payload before rendering", () => {
    // ESC + DEL must not leak into the DOM (they are stripped by the
    // helper's allow-list). The rendered text MUST equal what the
    // Fix-now button copies (single source of truth).
    const item = makeItem({
      source: "phaseQuality",
      launchPayload: "good\x1b[31mred\x7fpart",
    });
    render(<LaunchPayloadBlock item={item} />);
    const block = screen.getByTestId("triage-launch-payload-content");
    expect(block.textContent).toBe("good[31mredpart");
    expect(block.textContent?.includes("\x1b")).toBe(false);
    expect(block.textContent?.includes("\x7f")).toBe(false);
  });

  // @covers FR-01.30
  it("renders the github loud-failure placeholder when source=github and payload is null", () => {
    const item = makeItem({ source: "github", launchPayload: null });
    render(<LaunchPayloadBlock item={item} />);

    const placeholder = screen.getByTestId("triage-launch-payload-placeholder");
    expect(placeholder.textContent).toBe(GITHUB_PLACEHOLDER_TEXT);
    // No <pre> in the github branch.
    expect(screen.queryByTestId("triage-launch-payload-content")).toBeNull();
  });

  // @covers FR-01.30
  it("renders the github placeholder when source=github and payload collapses to empty after strip", () => {
    // Raw payload is non-empty (control-only); after strip it becomes
    // "". A naive renderer that branches on raw-emptiness would show an
    // empty `<pre>` here. The decision helper uses cleaned-emptiness so
    // the loud-failure surfaces correctly.
    const item = makeItem({
      source: "github",
      launchPayload: "\x07\x1b\x7f",
    });
    render(<LaunchPayloadBlock item={item} />);
    expect(
      screen.getByTestId("triage-launch-payload-placeholder").textContent,
    ).toBe(GITHUB_PLACEHOLDER_TEXT);
    expect(screen.queryByTestId("triage-launch-payload-content")).toBeNull();
  });

  // @covers FR-01.30
  it("renders nothing for legacy items (non-github, no payload)", () => {
    const item = makeItem({ source: "phaseQuality", launchPayload: null });
    const { container } = render(<LaunchPayloadBlock item={item} />);
    expect(container.firstChild).toBeNull();
  });

  // @covers FR-01.30
  it("renders nothing when the payload key is absent (undefined) on a non-github item", () => {
    const item = makeItem({ source: "compliance" });
    const { container } = render(<LaunchPayloadBlock item={item} />);
    expect(container.firstChild).toBeNull();
  });

  // @covers FR-01.30
  it("non-github + non-empty payload still renders the payload (not just github)", () => {
    const payload = "/iterate non-github producer";
    const item = makeItem({ source: "phaseQuality", launchPayload: payload });
    render(<LaunchPayloadBlock item={item} />);
    expect(screen.getByTestId("triage-launch-payload-content").textContent).toBe(
      payload,
    );
  });
});
