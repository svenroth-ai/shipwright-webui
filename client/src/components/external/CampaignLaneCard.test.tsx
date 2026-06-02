import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import { CampaignLaneCard } from "./CampaignLaneCard";
import type { Campaign } from "../../lib/campaignsApi";

const copyTextMock = vi.fn(async (_text: string) => {});
vi.mock("../../lib/clipboard", () => ({
  copyText: (t: string) => copyTextMock(t),
}));

function renderCard(campaign: Campaign) {
  return render(
    <MemoryRouter>
      <CampaignLaneCard campaign={campaign} />
    </MemoryRouter>,
  );
}

const BASE: Campaign = {
  slug: "2026-06-02-hook",
  intent: "Collapse hook fan-out",
  branchStrategy: "stacked",
  expandsTriage: null,
  steps: [
    { id: "B0", slug: "alpha", title: "Alpha", status: "complete", specPath: ".s/B0-alpha.md", commit: null, branch: null },
    { id: "B1", slug: "beta", title: "Beta", status: "failed", specPath: ".s/B1-beta.md", commit: null, branch: null },
    { id: "B2", slug: "gamma", title: "Gamma", status: "pending", specPath: ".s/B2-gamma.md", commit: null, branch: null },
  ],
  done: 1,
  total: 3,
  nextPending: { id: "B1", specPath: ".shipwright/planning/iterate/campaigns/2026-06-02-hook/sub-iterates/B1-beta.md" },
};

describe("CampaignLaneCard", () => {
  beforeEach(() => {
    copyTextMock.mockClear();
  });

  it("renders slug, intent, and done/total (AC-4)", () => {
    renderCard(BASE);
    expect(screen.getByText("2026-06-02-hook")).toBeInTheDocument();
    expect(screen.getByText("Collapse hook fan-out")).toBeInTheDocument();
    expect(screen.getByTestId("campaign-progress-2026-06-02-hook")).toHaveTextContent("1/3");
  });

  it("marks the first non-complete step as next-pending and completes the rest (AC-4)", () => {
    renderCard(BASE);
    expect(screen.getByTestId("campaign-step-B0")).toHaveAttribute("data-step-status", "complete");
    // B1 (failed) is the first non-complete → next-pending highlight
    expect(screen.getByTestId("campaign-step-B1")).toHaveAttribute("data-next", "true");
    expect(screen.getByTestId("campaign-step-B2")).not.toHaveAttribute("data-next");
    // failed status is surfaced as text
    expect(screen.getByTestId("campaign-step-B1")).toHaveTextContent("failed");
  });

  it("renders the ✓ / ▶ / ○ icon semantics per step (AC-4 visual)", () => {
    renderCard(BASE);
    // complete → ✓ (aria-label "complete")
    expect(
      within(screen.getByTestId("campaign-step-B0")).getByLabelText("complete"),
    ).toBeInTheDocument();
    // first non-complete → ▶ (aria-label "next pending")
    expect(
      within(screen.getByTestId("campaign-step-B1")).getByLabelText("next pending"),
    ).toBeInTheDocument();
    // other non-complete → ○ (aria-label "pending")
    expect(
      within(screen.getByTestId("campaign-step-B2")).getByLabelText("pending"),
    ).toBeInTheDocument();
  });

  it("copies the launch command for the next-pending step (AC-5)", async () => {
    renderCard(BASE);
    fireEvent.click(screen.getByTestId("campaign-launch-2026-06-02-hook"));
    await waitFor(() =>
      expect(copyTextMock).toHaveBeenCalledWith(
        '/shipwright-iterate ".shipwright/planning/iterate/campaigns/2026-06-02-hook/sub-iterates/B1-beta.md"',
      ),
    );
    expect(await screen.findByText("Copied")).toBeInTheDocument();
  });

  it("disables the launch button when there is no next-pending step (AC-5)", () => {
    renderCard({
      ...BASE,
      steps: BASE.steps.map((s) => ({ ...s, status: "complete" as const })),
      done: 3,
      nextPending: null,
    });
    expect(screen.getByTestId("campaign-launch-2026-06-02-hook")).toBeDisabled();
  });

  it("disables the launch button when the next-pending spec file is missing (AC-5)", () => {
    renderCard({ ...BASE, nextPending: { id: "B1", specPath: null } });
    expect(screen.getByTestId("campaign-launch-2026-06-02-hook")).toBeDisabled();
  });

  it("renders a triage cross-link only when expandsTriage is set (AC-7)", () => {
    const { rerender } = renderCard(BASE);
    expect(screen.queryByTestId("campaign-triage-link-2026-06-02-hook")).toBeNull();
    rerender(
      <MemoryRouter>
        <CampaignLaneCard campaign={{ ...BASE, expandsTriage: "trg-721b1765" }} />
      </MemoryRouter>,
    );
    const link = screen.getByTestId("campaign-triage-link-2026-06-02-hook");
    expect(link).toHaveAttribute("href", "/triage");
    expect(link).toHaveTextContent("trg-721b1765");
  });
});
