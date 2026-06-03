/*
 * VideoRenderer.test — iterate-2026-06-03-smartviewer-video-view, AC6.
 *
 *  - Renders a <video> whose src points at the /media route (no JS fetch).
 *  - onError swaps to the actionable fallback chip (415 / undecodable codec).
 */

import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { VideoRenderer } from "./VideoRenderer";

describe("VideoRenderer", () => {
  it("renders <video controls> pointing at the /media route", () => {
    render(<VideoRenderer projectId="proj-a" path="clips/demo.mp4" />);
    const container = screen.getByTestId("smart-viewer-video");
    const video = container.querySelector("video");
    expect(video).toBeTruthy();
    expect(video?.hasAttribute("controls")).toBe(true);
    expect(video?.getAttribute("preload")).toBe("metadata");
    expect(video?.getAttribute("src")).toBe(
      "/api/external/projects/proj-a/media?path=clips%2Fdemo.mp4",
    );
  });

  it("onError → fallback chip with the path", () => {
    render(<VideoRenderer projectId="proj-a" path="broken.mov" />);
    const video = screen.getByTestId("smart-viewer-video").querySelector("video");
    expect(video).toBeTruthy();
    fireEvent.error(video!);
    const chip = screen.getByTestId("smart-viewer-video-error");
    expect(chip.textContent).toContain("broken.mov");
    // The <video> element is gone once the chip is shown.
    expect(screen.queryByTestId("smart-viewer-video")).toBeNull();
  });
});
