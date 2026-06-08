import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { CampaignStartCta } from "./CampaignStartCta";

function renderCta(
  status: "draft" | "active" | "complete" | null,
  over: Partial<{ isStarting: boolean; error: string | null }> = {},
) {
  const onStart = vi.fn();
  const onGoToBoard = vi.fn();
  render(
    <CampaignStartCta
      slug="2026-06-08-x"
      status={status}
      isStarting={over.isStarting ?? false}
      error={over.error ?? null}
      onStart={onStart}
      onGoToBoard={onGoToBoard}
    />,
  );
  return { onStart, onGoToBoard };
}

describe("CampaignStartCta", () => {
  // AC-6 regression: an ALREADY-running (active) campaign must never offer a
  // second "Start Campaign" — that is the triage-side double-launch footgun.
  // Once active the CTA is "Go to board" (no status write, no orchestrator).
  it("AC-6: status=active renders 'Go to board', NOT a second Start Campaign", () => {
    const { onStart, onGoToBoard } = renderCta("active");
    expect(screen.queryByTestId("triage-start-campaign")).toBeNull();
    const goto = screen.getByTestId("triage-go-to-board");
    fireEvent.click(goto);
    expect(onGoToBoard).toHaveBeenCalledTimes(1);
    expect(onStart).not.toHaveBeenCalled();
  });

  it("draft renders 'Start Campaign' and calls onStart", () => {
    const { onStart, onGoToBoard } = renderCta("draft");
    fireEvent.click(screen.getByTestId("triage-start-campaign"));
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onGoToBoard).not.toHaveBeenCalled();
  });

  it("legacy null status also offers Start Campaign", () => {
    renderCta(null);
    expect(screen.getByTestId("triage-start-campaign")).toBeInTheDocument();
  });

  it("complete renders a static note and no buttons", () => {
    renderCta("complete");
    expect(screen.getByTestId("triage-campaign-complete")).toBeInTheDocument();
    expect(screen.queryByTestId("triage-start-campaign")).toBeNull();
    expect(screen.queryByTestId("triage-go-to-board")).toBeNull();
  });
});
