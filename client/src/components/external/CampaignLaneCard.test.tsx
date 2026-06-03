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

/** Click the card header toggle to expand it. */
function expand(slug: string) {
  fireEvent.click(screen.getByTestId(`campaign-toggle-${slug}`));
}

const SLUG = "2026-06-02-hook";
const BASE: Campaign = {
  slug: SLUG,
  intent: "Collapse hook fan-out",
  branchStrategy: "stacked",
  expandsTriage: null,
  status: null,
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
    localStorage.clear();
  });

  // ---- collapse / expand (AC-1, AC-2, AC-6) ----

  it("is collapsed by default: header (slug + done/total) shown, body hidden", () => {
    renderCard(BASE);
    expect(screen.getByText(SLUG)).toBeInTheDocument();
    expect(screen.getByTestId(`campaign-progress-${SLUG}`)).toHaveTextContent("1/3");
    // body hidden
    expect(screen.queryByTestId("campaign-step-B0")).toBeNull();
    expect(screen.queryByTestId(`campaign-launch-${SLUG}`)).toBeNull();
    expect(screen.queryByTestId(`campaign-description-toggle-${SLUG}`)).toBeNull();
  });

  it("expands on header click and collapses again (toggle)", () => {
    renderCard(BASE);
    expand(SLUG);
    expect(screen.getByTestId("campaign-step-B0")).toBeInTheDocument();
    expect(screen.getByTestId(`campaign-launch-${SLUG}`)).toBeInTheDocument();
    // collapse again
    fireEvent.click(screen.getByTestId(`campaign-toggle-${SLUG}`));
    expect(screen.queryByTestId("campaign-step-B0")).toBeNull();
  });

  // ---- persistence (AC-3) ----

  it("persists the expanded state to localStorage (per slug)", () => {
    renderCard(BASE);
    expand(SLUG);
    expect(localStorage.getItem(`webui:campaign-card-collapsed:${SLUG}`)).toBe("false");
  });

  it("reads the persisted expanded state on mount (starts expanded)", () => {
    localStorage.setItem(`webui:campaign-card-collapsed:${SLUG}`, "false");
    renderCard(BASE);
    expect(screen.getByTestId("campaign-step-B0")).toBeInTheDocument();
  });

  it("persistence is per-slug (one campaign expanded does not expand another)", () => {
    localStorage.setItem(`webui:campaign-card-collapsed:${SLUG}`, "false");
    renderCard({ ...BASE, slug: "other-slug" });
    // 'other-slug' has no stored pref → stays collapsed
    expect(screen.queryByTestId("campaign-step-B0")).toBeNull();
  });

  // ---- description disclosure (AC-4) ----

  it("description is behind a disclosure, closed by default, opens on click + persists", () => {
    localStorage.setItem(`webui:campaign-card-collapsed:${SLUG}`, "false"); // expanded
    renderCard(BASE);
    // closed by default → intent text not shown
    expect(screen.queryByText("Collapse hook fan-out")).toBeNull();
    fireEvent.click(screen.getByTestId(`campaign-description-toggle-${SLUG}`));
    expect(screen.getByText("Collapse hook fan-out")).toBeInTheDocument();
    expect(localStorage.getItem(`webui:campaign-desc-open:${SLUG}`)).toBe("true");
  });

  // ---- existing behaviors, now behind expand (AC parity) ----

  it("renders done/total + the next-pending highlight + failed status when expanded", () => {
    renderCard(BASE);
    expand(SLUG);
    expect(screen.getByTestId("campaign-step-B0")).toHaveAttribute("data-step-status", "complete");
    expect(screen.getByTestId("campaign-step-B1")).toHaveAttribute("data-next", "true");
    expect(screen.getByTestId("campaign-step-B2")).not.toHaveAttribute("data-next");
    expect(screen.getByTestId("campaign-step-B1")).toHaveTextContent("failed");
  });

  it("renders complete / next / pending icon semantics per step", () => {
    renderCard(BASE);
    expand(SLUG);
    expect(within(screen.getByTestId("campaign-step-B0")).getByLabelText("complete")).toBeInTheDocument();
    expect(within(screen.getByTestId("campaign-step-B1")).getByLabelText("next pending")).toBeInTheDocument();
    expect(within(screen.getByTestId("campaign-step-B2")).getByLabelText("pending")).toBeInTheDocument();
  });

  it("copies the launch command for the next-pending step", async () => {
    renderCard(BASE);
    expand(SLUG);
    fireEvent.click(screen.getByTestId(`campaign-launch-${SLUG}`));
    await waitFor(() =>
      expect(copyTextMock).toHaveBeenCalledWith(
        '/shipwright-iterate ".shipwright/planning/iterate/campaigns/2026-06-02-hook/sub-iterates/B1-beta.md"',
      ),
    );
    expect(await screen.findByText("Copied")).toBeInTheDocument();
  });

  it("disables the launch button when there is no launchable next step", () => {
    renderCard({
      ...BASE,
      steps: BASE.steps.map((s) => ({ ...s, status: "complete" as const })),
      done: 3,
      nextPending: null,
    });
    expand(SLUG);
    expect(screen.getByTestId(`campaign-launch-${SLUG}`)).toBeDisabled();
  });

  it("disables the launch button when the next-pending spec file is missing", () => {
    renderCard({ ...BASE, nextPending: { id: "B1", specPath: null } });
    expand(SLUG);
    expect(screen.getByTestId(`campaign-launch-${SLUG}`)).toBeDisabled();
  });

  it("renders a triage cross-link only when expandsTriage is set (expanded)", () => {
    renderCard(BASE);
    expand(SLUG);
    expect(screen.queryByTestId(`campaign-triage-link-${SLUG}`)).toBeNull();
    // re-render with expandsTriage set, pre-expanded
    localStorage.setItem(`webui:campaign-card-collapsed:${SLUG}`, "false");
    render(
      <MemoryRouter>
        <CampaignLaneCard campaign={{ ...BASE, expandsTriage: "trg-721b1765" }} />
      </MemoryRouter>,
    );
    const link = screen.getByTestId(`campaign-triage-link-${SLUG}`);
    expect(link).toHaveAttribute("href", "/triage");
    expect(link).toHaveTextContent("trg-721b1765");
  });
});
