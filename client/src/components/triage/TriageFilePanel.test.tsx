/*
 * Regression guard for iterate-2026-08-30-triage-file-viewer-followups: the
 * panel silently clipped long file content with NO scrollbar in either axis.
 * Root cause, confirmed via live-browser DOM measurement: the outer
 * container had `min-w-0` but was missing `min-h-0`, so as a flex item it
 * grew to its content's natural size instead of shrinking to the allotted
 * space — Dialog.Content then clipped the overflow with `overflow-hidden`
 * instead of a scrollbar. A second, deeper issue (Dialog.Content's
 * `max-height`-only sizing not being a "definite" height for this panel's
 * `h-full` to resolve against) is fixed on the Dialog.Content side — see
 * TriageDetailModal.tsx and the doc comment on TriageFilePanel itself.
 * jsdom does not lay out real pixels, so the actual overflow can only be
 * proven by the browser E2E test — this is the fast, always-on regression
 * check that both classNames stay in place.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { TriageFilePanel } from "./TriageFilePanel";

vi.mock("../external/SmartViewer", () => ({
  SmartViewer: ({ path }: { path: string | null }) => (
    <div data-testid="smart-viewer-mock">{path}</div>
  ),
}));

describe("TriageFilePanel", () => {
  it("bounds BOTH axes of its outer flex container (min-h-0 AND min-w-0)", () => {
    render(<TriageFilePanel projectId="p1" path="architecture.md" onClose={() => {}} />);
    const panel = screen.getByTestId("triage-file-panel");
    expect(panel.className).toContain("min-h-0");
    expect(panel.className).toContain("min-w-0");
  });
});
