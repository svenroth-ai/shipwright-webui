/*
 * MockupReviewOverlay.test.tsx — the security-critical postMessage handler:
 * a feedback message is written ONLY when origin AND source validate
 * (plan review R7). The full happy path (real iframe → bridge → write) is
 * covered by E2E flow 100; this pins the rejection branches jsdom can exercise.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";

import { MockupReviewOverlay } from "./MockupReviewOverlay";
import { DESIGN_FEEDBACK_MESSAGE_TYPE } from "../../lib/designReviewApi";

const writeDesignFeedback = vi.fn();

vi.mock("../../lib/designReviewApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/designReviewApi")>();
  return {
    ...actual,
    writeDesignFeedback: (...args: unknown[]) => writeDesignFeedback(...args),
  };
});

function renderOverlay() {
  render(
    <MockupReviewOverlay open onOpenChange={() => {}} projectId="p1" />,
  );
  return screen.getByTestId("mockup-review-iframe") as HTMLIFrameElement;
}

function feedbackEvent(source: Window | null, origin: string): MessageEvent {
  return new MessageEvent("message", {
    data: { type: DESIGN_FEEDBACK_MESSAGE_TYPE, markdown: "# Design Feedback — Round 1" },
    origin,
    source,
  });
}

beforeEach(() => {
  writeDesignFeedback.mockReset();
  writeDesignFeedback.mockResolvedValue({ written: true, round: 1, path: "x" });
});
afterEach(cleanup);

describe("MockupReviewOverlay postMessage validation", () => {
  // @covers FR-01.45
  it("writes + shows 'Saved — Round N' for a valid same-origin message from the iframe", async () => {
    const iframe = renderOverlay();
    window.dispatchEvent(feedbackEvent(iframe.contentWindow, window.location.origin));
    await waitFor(() => expect(writeDesignFeedback).toHaveBeenCalledTimes(1));
    expect(writeDesignFeedback).toHaveBeenCalledWith("p1", expect.stringContaining("# Design Feedback"));
    await waitFor(() =>
      expect(screen.getByTestId("mockup-review-saved")).toHaveTextContent(/Round 1/),
    );
  });

  // @covers FR-01.45
  it("IGNORES a message from a different origin", async () => {
    const iframe = renderOverlay();
    window.dispatchEvent(feedbackEvent(iframe.contentWindow, "https://evil.example"));
    await new Promise((r) => setTimeout(r, 20));
    expect(writeDesignFeedback).not.toHaveBeenCalled();
  });

  // @covers FR-01.45
  it("IGNORES a same-origin message whose source is NOT the hosted iframe", async () => {
    renderOverlay();
    window.dispatchEvent(feedbackEvent(window, window.location.origin));
    await new Promise((r) => setTimeout(r, 20));
    expect(writeDesignFeedback).not.toHaveBeenCalled();
  });
});
