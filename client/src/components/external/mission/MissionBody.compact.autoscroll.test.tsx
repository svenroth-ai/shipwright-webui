/*
 * MissionBody.compact.autoscroll.test.tsx — split out of
 * MissionBody.compact.test.tsx (2026-08-31, iterate-2026-08-31-mission-feed-gaps)
 * to stay under the 300-line file-size limit, the same reason that file's
 * sibling split files exist.
 *
 * @covers FR-01.66
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ExternalTask } from "../../../lib/externalApi";
import type { RunDataJoin, RunDetailResponse } from "../../../lib/runDataApi";

const missionStateMock = vi.fn<() => "done" | "live" | "designgate">();
const runDetailMock = vi.fn<() => { data: RunDetailResponse | undefined }>();
const missionContextMock = vi.fn<() => { data: unknown }>();
vi.mock("../../../hooks/useMissionState", () => ({
  useMissionState: () => missionStateMock(),
}));
vi.mock("../../../hooks/useRunData", () => ({
  useRunDetail: () => runDetailMock(),
}));
vi.mock("../../../hooks/useCampaigns", () => ({ useCampaigns: () => ({ data: [] }) }));
vi.mock("./DesignGateCard", () => ({
  DesignGateCard: () => <div data-testid="design-gate-card-stub" />,
}));
vi.mock("../../../hooks/useMissionContext", () => ({
  useMissionContext: () => missionContextMock(),
  useArtifactDocument: () => ({ data: undefined, isPending: false, isError: false }),
}));

import { MissionBody } from "./MissionBody";

const originalMatchMedia = window.matchMedia;
const TASK = {
  projectId: "p1",
  runId: "iterate-2026-07-16-x",
  title: "Survey the hull",
} as unknown as ExternalTask;
const COMPLETED_RUN = {
  runId: "iterate-2026-07-16-x",
  summary: "Ship the survey",
  commit: "abc1234",
  affectedFrs: ["FR-01.66"],
  specImpact: "add",
  tests: { passed: 12, total: 12 },
  gates: { derived: true, review: "pass" },
} as unknown as RunDataJoin;

beforeEach(() => {
  missionContextMock.mockReturnValue({ data: undefined });
});

afterEach(() => {
  missionStateMock.mockReset();
  runDetailMock.mockReset();
  missionContextMock.mockReset();
  window.matchMedia = originalMatchMedia;
});

function setCompact(compact: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query === "(max-width: 1023px)" ? compact : false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

function setupCompletedCompact(transcriptContent = "") {
  setCompact(true);
  missionStateMock.mockReturnValue("done");
  runDetailMock.mockReturnValue({
    data: { status: "ok", run: COMPLETED_RUN } as RunDetailResponse,
  });
  render(
    <MissionBody task={TASK} transcriptContent={transcriptContent} onOpenDocument={vi.fn()} />,
  );
}

describe("MissionBody — compact Activity re-pins on becoming visible", () => {
  // external code review, openai MEDIUM: the activity panel MOUNTS hidden
  // under `compactPanel === "overview"`, so its mount-time auto-scroll
  // re-pin is a no-op against a hidden ancestor's collapsed layout —
  // switching TO the Activity tab must itself trigger a fresh re-pin. The
  // getter below mimics that real-browser collapse (jsdom does no layout at
  // all, so scrollHeight must be modeled explicitly): 0 while a `[hidden]`
  // ancestor exists, a real height once it does not. Without `visible`
  // threaded into `useAutoScroll`'s dep, the tab switch changes neither
  // `feed.cards.length` nor the DOM node, so the layout effect would never
  // re-run and this assertion would fail on the pre-fix code.
  it("re-pins to the bottom when the Activity tab becomes visible, not just at mount", async () => {
    const restore = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollHeight");
    Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
      configurable: true,
      get(this: HTMLElement) {
        return this.closest("[hidden]") ? 0 : 5_000;
      },
    });
    try {
      setupCompletedCompact(JSON.stringify({
        type: "assistant",
        message: {
          content: [{
            type: "tool_use",
            id: "spec-write",
            name: "Edit",
            input: { file_path: "/project/.shipwright/planning/iterate/mobile.md" },
          }],
        },
      }));
      expect(screen.getByTestId("mission-panel-activity")).toHaveAttribute("hidden");

      fireEvent.click(screen.getByTestId("mission-compact-tab-activity"));
      expect(screen.getByTestId("mission-panel-activity")).not.toHaveAttribute("hidden");

      const timeline = screen.getByTestId("mission-activity-feed");
      await waitFor(() => expect(timeline.scrollTop).toBe(5_000));
    } finally {
      if (restore) Object.defineProperty(HTMLElement.prototype, "scrollHeight", restore);
    }
  });
});
