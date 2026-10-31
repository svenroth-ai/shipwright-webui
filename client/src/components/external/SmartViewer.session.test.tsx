import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { SmartViewer } from "./SmartViewer";

const OUTSIDE = "D:/other/media/clip";

// @covers FR-01.66
describe("SmartViewer with sessionTaskId keeps the session source for every renderer", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<p>outside html</p>", { status: 200 })),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  const sessionPart = "/api/external/tasks/t1/session-file?path=";

  it("image: the <img> reads the session-file route", () => {
    render(<SmartViewer projectId="p1" path={`${OUTSIDE}.png`} sessionTaskId="t1" />);
    const src = screen.getByRole("img").getAttribute("src") ?? "";
    expect(src).toContain(sessionPart);
    expect(decodeURIComponent(src)).toContain(`${OUTSIDE}.png`);
  });

  it("video: the <video> reads the session-file route", () => {
    const { container } = render(<SmartViewer projectId="p1" path={`${OUTSIDE}.mp4`} sessionTaskId="t1" />);
    const src = container.querySelector("video")?.getAttribute("src") ?? "";
    expect(src).toContain(sessionPart);
  });

  it("html: text AND the pop-out modal both fetch from the session-file route, never the project route", async () => {
    render(<SmartViewer projectId="p1" path={`${OUTSIDE}.html`} sessionTaskId="t1" />);
    const popOut = await screen.findByTestId("smart-viewer-popout");
    fireEvent.click(popOut);
    await screen.findByTestId("smart-viewer-modal");
    const fetchMock = vi.mocked(fetch);
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2));
    for (const call of fetchMock.mock.calls) {
      expect(String(call[0])).toContain(sessionPart);
      expect(String(call[0])).not.toContain("/projects/");
    }
  });
});
