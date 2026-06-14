import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { CampaignLaneCard } from "./CampaignLaneCard";
import type { Campaign } from "../../lib/campaignsApi";
import type { Project } from "../../types";

const PROJECT: Project = {
  id: "p1", name: "proj", path: "/proj", profile: "node",
  status: "active", lastActive: "", createdAt: "",
};

function renderCard(campaign: Campaign, project: Project | null = PROJECT) {
  // QueryClientProvider — the embedded Campaign{Step,Autonomous}LaunchButton use
  // useLaunchCampaign{,Step} → useQueryClient (FR-01.34 / FR-01.36).
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <CampaignLaneCard campaign={campaign} project={project} />
      </MemoryRouter>
    </QueryClientProvider>,
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
    { id: "B0", slug: "alpha", title: "Alpha", status: "complete", specPath: ".s/B0-alpha.md", commit: null, branch: null, planFirst: false },
    { id: "B1", slug: "beta", title: "Beta", status: "failed", specPath: ".s/B1-beta.md", commit: null, branch: null, planFirst: false },
    { id: "B2", slug: "gamma", title: "Gamma", status: "pending", specPath: ".s/B2-gamma.md", commit: null, branch: null, planFirst: false },
  ],
  done: 1,
  total: 3,
  nextPending: { id: "B1", specPath: ".shipwright/planning/iterate/campaigns/2026-06-02-hook/sub-iterates/B1-beta.md" },
};

describe("CampaignLaneCard", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  // ---- visual: flat card, no heavy drop shadow (Sven UAT 2026-06-12) ----

  it("renders a flat card with no drop shadow (heavy --shadow-card removed)", () => {
    renderCard(BASE);
    const card = screen.getByTestId(`campaign-lane-card-${SLUG}`);
    // The lane card used `shadow-[var(--shadow-card,none)]` (0 6px 30px) which
    // sat much heavier than the subtle kanban TaskCards below it. The card is
    // now border-only — no `shadow-*` utility at all.
    expect(card.className).not.toMatch(/\bshadow-/);
  });

  // ---- collapse / expand (AC-1, AC-2, AC-6) ----

  it("is collapsed by default: header (slug + done/total) shown, body hidden", () => {
    renderCard(BASE);
    expect(screen.getByText(SLUG)).toBeInTheDocument();
    expect(screen.getByTestId(`campaign-progress-${SLUG}`)).toHaveTextContent("1/3");
    // body hidden
    expect(screen.queryByTestId("campaign-step-B0")).toBeNull();
    expect(screen.queryByTestId(`campaign-step-launch-${SLUG}`)).toBeNull();
    expect(screen.queryByTestId(`campaign-description-toggle-${SLUG}`)).toBeNull();
  });

  // ---- tablet overflow hardening (iterate-2026-06-14-tablet-responsive-view AC-3) ----

  it("step rows let long titles truncate (min-w-0 + truncate) so the card can't overflow at tablet width", () => {
    renderCard(BASE);
    expand(SLUG);
    const step = screen.getByTestId("campaign-step-B0");
    expect(step.className).toContain("min-w-0");
    const title = within(step).getByText("Alpha");
    expect(title.className).toContain("truncate");
    expect(title.className).toContain("min-w-0");
  });

  it("expands on header click and collapses again (toggle)", () => {
    renderCard(BASE);
    expand(SLUG);
    expect(screen.getByTestId("campaign-step-B0")).toBeInTheDocument();
    expect(screen.getByTestId(`campaign-step-launch-${SLUG}`)).toBeInTheDocument();
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

  it("AC-6: renders a live in_progress step distinctly (spinner + label), overriding the next-marker", () => {
    // B1 is BOTH nextPending and in_progress → the in_progress icon must win
    // over the next-pending icon (live feedback beats 'about to start').
    renderCard({
      ...BASE,
      steps: [
        { id: "B0", slug: "alpha", title: "Alpha", status: "complete", specPath: ".s/B0-alpha.md", commit: null, branch: null, planFirst: false },
        { id: "B1", slug: "beta", title: "Beta", status: "in_progress", specPath: ".s/B1-beta.md", commit: null, branch: null, planFirst: false },
        { id: "B2", slug: "gamma", title: "Gamma", status: "pending", specPath: ".s/B2-gamma.md", commit: null, branch: null, planFirst: false },
      ],
    });
    expand(SLUG);
    const step = screen.getByTestId("campaign-step-B1");
    expect(step).toHaveAttribute("data-step-status", "in_progress");
    expect(within(step).getByLabelText("in progress")).toBeInTheDocument();
    expect(within(step).queryByLabelText("next pending")).toBeNull();
    expect(step).toHaveTextContent("in_progress");
    // a plain pending step keeps the pending icon — visually distinct.
    expect(within(screen.getByTestId("campaign-step-B2")).getByLabelText("pending")).toBeInTheDocument();
  });

  // ---- launch affordance (FR-01.36 — replaces the old "Copy launch") ----

  it("renders the Launch button labelled for the next-pending step (no Copy button)", () => {
    renderCard(BASE);
    expand(SLUG);
    const btn = screen.getByTestId(`campaign-step-launch-${SLUG}`);
    expect(btn).toHaveTextContent("Launch (B1)");
    // the old copy affordance is gone
    expect(screen.queryByTestId(`campaign-launch-${SLUG}`)).toBeNull();
  });

  it("disables the Launch button when there is no launchable next step", () => {
    renderCard({
      ...BASE,
      steps: BASE.steps.map((s) => ({ ...s, status: "complete" as const })),
      done: 3,
      nextPending: null,
    });
    expand(SLUG);
    expect(screen.getByTestId(`campaign-step-launch-${SLUG}`)).toBeDisabled();
  });

  it("disables the Launch button when the next-pending spec file is missing", () => {
    renderCard({ ...BASE, nextPending: { id: "B1", specPath: null } });
    expand(SLUG);
    expect(screen.getByTestId(`campaign-step-launch-${SLUG}`)).toBeDisabled();
  });

  it("disables the Launch button when no project is resolved", () => {
    renderCard(BASE, null);
    expand(SLUG);
    expect(screen.getByTestId(`campaign-step-launch-${SLUG}`)).toBeDisabled();
  });

  it("renders a triage cross-link only when expandsTriage is set (expanded)", () => {
    renderCard(BASE);
    expand(SLUG);
    expect(screen.queryByTestId(`campaign-triage-link-${SLUG}`)).toBeNull();
    // re-render with expandsTriage set, pre-expanded
    localStorage.setItem(`webui:campaign-card-collapsed:${SLUG}`, "false");
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <CampaignLaneCard campaign={{ ...BASE, expandsTriage: "trg-721b1765" }} project={PROJECT} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const link = screen.getByTestId(`campaign-triage-link-${SLUG}`);
    expect(link).toHaveAttribute("href", "/triage");
    expect(link).toHaveTextContent("trg-721b1765");
  });
});
