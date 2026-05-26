/*
 * StateBadge.test — Campaign C / C6.
 *
 * Happy + edge paths:
 *  - every TaskStatus enum value renders the canonical label (7 cases).
 *  - pulse animation present on `active` / `awaiting_external_start`,
 *    absent elsewhere (edge: validates the boolean toggle path).
 *  - testid stability: `task-state-badge` + `task-detail-state-dot` preserved.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { StateBadge } from "./StateBadge";
import type { ExternalTaskState } from "../../../lib/externalApi";

const CASES: ReadonlyArray<{
  state: ExternalTaskState;
  label: string;
  shouldPulse: boolean;
}> = [
  { state: "draft", label: "Draft", shouldPulse: false },
  { state: "awaiting_external_start", label: "Awaiting launch", shouldPulse: true },
  { state: "active", label: "In progress", shouldPulse: true },
  { state: "idle", label: "Idle", shouldPulse: false },
  { state: "jsonl_missing", label: "JSONL missing", shouldPulse: false },
  { state: "launch_failed", label: "Launch failed", shouldPulse: false },
  { state: "done", label: "Done", shouldPulse: false },
];

describe("StateBadge — label matrix (happy path)", () => {
  it.each(CASES)("$state renders label '$label'", ({ state, label }) => {
    render(<StateBadge state={state} />);
    const badge = screen.getByTestId("task-state-badge");
    expect(badge.textContent).toContain(label);
    // testid stability assertion.
    expect(screen.getByTestId("task-detail-state-dot")).toBeTruthy();
  });
});

describe("StateBadge — pulse-animation toggle (edge path)", () => {
  it.each(CASES)(
    "$state pulse=$shouldPulse — dot animation inline style matches",
    ({ state, shouldPulse }) => {
      render(<StateBadge state={state} />);
      const dot = screen.getByTestId("task-detail-state-dot");
      const anim = (dot as HTMLElement).style.animation;
      if (shouldPulse) {
        expect(anim).toContain("taskDetailPulseDot");
      } else {
        expect(anim).toBe("");
      }
    },
  );

  it("data-state attribute mirrors the prop (for E2E targeting)", () => {
    render(<StateBadge state="active" />);
    const dot = screen.getByTestId("task-detail-state-dot");
    expect(dot.getAttribute("data-state")).toBe("active");
  });
});
