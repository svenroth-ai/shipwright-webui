/*
 * The campaign card as a dependency-graph view (card trg-e542ce03). The card
 * RENDERS the monorepo scheduler's verdict (`GET …/readiness`); it never derives
 * readiness from the `dependsOn` edges. Covered: edges, ready / waiting / in-flight
 * rows, per-unit guided Launch only for READY units, the no-verdict fallback to
 * the card-level "Launch next", and every unavailable-state banner.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const readinessMock = vi.fn();
vi.mock("../../lib/campaignReadinessApi", async (orig) => {
  const actual = await orig<typeof import("../../lib/campaignReadinessApi")>();
  return { ...actual, fetchCampaignReadiness: (...a: unknown[]) => readinessMock(...a) };
});

const launchStepMock = vi.fn();
vi.mock("../../hooks/useLaunchCampaignStep", () => ({ useLaunchCampaignStep: () => launchStepMock }));

import { CampaignLaneCard } from "./CampaignLaneCard";
import type { Campaign, CampaignStep } from "../../lib/campaignsApi";
import type { CampaignReadiness, ReadinessReport, UnitReadiness } from "../../lib/campaignReadinessApi";
import type { Project } from "../../types";

const PROJECT: Project = { id: "p1", name: "proj", path: "/proj", profile: "node", status: "active", lastActive: "", createdAt: "" };
const SLUG = "2026-09-29-dag";

const step = (id: string, over: Partial<CampaignStep> = {}): CampaignStep => ({
  id, slug: id.toLowerCase(), title: `Title ${id}`, status: "pending",
  specPath: `.s/${id}.md`, commit: null, branch: null, planFirst: false, dependsOn: [], ...over,
});

const CAMPAIGN: Campaign = {
  slug: SLUG, intent: "x", branchStrategy: "independent", expandsTriage: null, status: "active",
  steps: [step("A"), step("B", { dependsOn: ["A"] }), step("C", { dependsOn: ["A", "B"] })],
  done: 0, total: 3, nextPending: { id: "A", specPath: ".s/A.md" },
} as Campaign;

const unit = (id: string, state: string, ready: boolean, blocked_by: UnitReadiness["blocked_by"] = []): UnitReadiness => ({ id, state, ready, blocked_by });
const report = (units: UnitReadiness[], over: Partial<ReadinessReport> = {}): CampaignReadiness => ({
  status: "report",
  report: {
    schema_version: "1.0", loop_id: "L", branch_strategy: "independent", base_branch: "main",
    supported: true, finalized: false, ready_ids: units.filter((u) => u.ready).map((u) => u.id), units, ...over,
  },
});

function renderExpanded(campaign: Campaign = CAMPAIGN) {
  localStorage.setItem(`webui:campaign-card-collapsed:${campaign.slug}`, "false");
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <CampaignLaneCard campaign={campaign} project={PROJECT} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  readinessMock.mockReset();
  launchStepMock.mockReset();
});

describe("CampaignLaneCard — dependency graph", () => {
  it("shows each unit's dependency edges", async () => {
    readinessMock.mockResolvedValue({ status: "no-loop" });
    renderExpanded();
    expect(screen.getByTestId("campaign-unit-deps-B")).toHaveTextContent("after A");
    expect(screen.getByTestId("campaign-unit-deps-C")).toHaveTextContent("after A, B");
    expect(screen.queryByTestId("campaign-unit-deps-A")).toBeNull();
  });

  it("marks a READY unit and blocks the rest, naming the edge in plain language", async () => {
    readinessMock.mockResolvedValue(report([
      unit("A", "pending", true),
      unit("B", "pending", false, [{ id: "A", reason: "not_merged", detail: "A has status 'pending'" }]),
      unit("C", "pending", false, [
        { id: "A", reason: "not_merged", detail: "" },
        { id: "B", reason: "commit_not_on_base", detail: "" },
      ]),
    ]));
    renderExpanded();
    await screen.findByTestId("campaign-unit-ready-A");
    expect(screen.getByTestId("campaign-step-A")).toHaveAttribute("data-dag-kind", "ready");
    expect(screen.getByTestId("campaign-step-B")).toHaveAttribute("data-dag-kind", "waiting");
    expect(screen.getByTestId("campaign-step-B")).toHaveTextContent("waiting for A to merge");
    expect(screen.getByTestId("campaign-step-C")).toHaveTextContent("B merged, but its commit hasn't reached the base branch yet");
  });

  it("offers a per-unit Launch ONLY on ready units — never on a blocked one", async () => {
    readinessMock.mockResolvedValue(report([
      unit("A", "pending", true),
      unit("B", "pending", false, [{ id: "A", reason: "not_merged", detail: "" }]),
      unit("C", "pending", false, [{ id: "B", reason: "not_merged", detail: "" }]),
    ]));
    renderExpanded();
    await screen.findByTestId(`campaign-step-launch-${SLUG}-A`);
    expect(screen.queryByTestId(`campaign-step-launch-${SLUG}-B`)).toBeNull();
    expect(screen.queryByTestId(`campaign-step-launch-${SLUG}-C`)).toBeNull();
  });

  it("with a verdict the card-level 'Launch next' is replaced by the per-unit controls", async () => {
    readinessMock.mockResolvedValue(report([unit("A", "pending", true)]));
    renderExpanded();
    await screen.findByTestId(`campaign-step-launch-${SLUG}-A`);
    expect(screen.queryByTestId(`campaign-step-launch-${SLUG}`)).toBeNull();
    // the autonomous run stays a per-campaign action
    expect(screen.getByTestId(`campaign-autonomous-launch-${SLUG}`)).toBeInTheDocument();
  });

  it("a ready unit's Launch confirms, then launches THAT unit (guided), not the next-pending one", async () => {
    readinessMock.mockResolvedValue(report([
      unit("A", "merged", false),
      unit("B", "pending", true),
    ]));
    launchStepMock.mockResolvedValue({ ok: true, taskId: "t9", commands: {} });
    renderExpanded();
    fireEvent.click(await screen.findByTestId(`campaign-step-launch-${SLUG}-B`));
    fireEvent.click(await screen.findByTestId(`campaign-step-confirm-${SLUG}`));
    await waitFor(() =>
      expect(launchStepMock).toHaveBeenCalledWith({ project: { id: "p1", path: "/proj" }, slug: SLUG, stepId: "B" }),
    );
  });

  it("shows the scheduler's in-flight state for a running unit and treats a merged unit as done", async () => {
    readinessMock.mockResolvedValue(report([unit("A", "merged", false), unit("B", "running", false), unit("C", "failed", false)]));
    renderExpanded();
    await screen.findByTestId("campaign-unit-state-B");
    expect(screen.getByTestId("campaign-step-A")).toHaveAttribute("data-dag-kind", "complete");
    expect(screen.getByTestId("campaign-step-B")).toHaveAttribute("data-dag-kind", "in_progress");
    expect(screen.getByTestId("campaign-unit-state-B")).toHaveTextContent("running");
    expect(screen.getByTestId("campaign-unit-state-C")).toHaveTextContent("failed");
    expect(screen.getByTestId("campaign-step-C")).toHaveAttribute("data-dag-kind", "other");
  });

  it("a campaign-level gate is stated once in the banner, not repeated on every row", async () => {
    readinessMock.mockResolvedValue(report(
      [unit("A", "pending", false, [{ id: null, reason: "unsupported_strategy", detail: "stacked" }])],
      { supported: false, branch_strategy: "stacked", ready_ids: [] },
    ));
    renderExpanded();
    const banner = await screen.findByTestId(`campaign-readiness-banner-${SLUG}`);
    expect(banner).toHaveTextContent("can't schedule this campaign");
    expect(screen.queryByTestId("campaign-unit-blocker-A")).toBeNull();
  });

  it("a campaign-level gate keeps the card-level 'Launch next' — otherwise nothing could be hand-launched", async () => {
    readinessMock.mockResolvedValue(report(
      [unit("A", "pending", false, [{ id: null, reason: "unsupported_strategy", detail: "stacked" }])],
      { supported: false, ready_ids: [] },
    ));
    renderExpanded();
    await screen.findByTestId(`campaign-readiness-banner-${SLUG}`);
    expect(screen.getByTestId(`campaign-step-launch-${SLUG}`)).toBeInTheDocument();
  });

  it("a next-pending step the scheduler has no row for is still launchable per-unit", async () => {
    readinessMock.mockResolvedValue(report([unit("Z", "pending", true)]));
    renderExpanded();
    expect(await screen.findByTestId(`campaign-step-launch-${SLUG}-A`)).toBeInTheDocument();
  });
});

describe("CampaignLaneCard — no scheduler verdict (degrades to today's behaviour)", () => {
  it.each<[string, CampaignReadiness, RegExp | null]>([
    ["no loop running", { status: "no-loop" }, /No autonomous run is set up/],
    ["engine unavailable", { status: "engine-unavailable", reason: "uv isn't installed" }, /Readiness unavailable: uv isn't installed/],
    ["failed", { status: "failed", reason: "boom" }, /Readiness check failed: boom/],
    ["unsupported version", { status: "unsupported-version", version: "2.0" }, /newer readiness format \(2\.0\)/],
  ])("%s → banner, edges kept, card-level 'Launch next' stays, no per-unit Launch", async (_n, outcome, text) => {
    readinessMock.mockResolvedValue(outcome);
    renderExpanded();
    const banner = await screen.findByTestId(`campaign-readiness-banner-${SLUG}`);
    if (text) expect(banner).toHaveTextContent(text);
    expect(screen.getByTestId(`campaign-step-launch-${SLUG}`)).toBeInTheDocument();
    expect(screen.queryByTestId(`campaign-step-launch-${SLUG}-A`)).toBeNull();
    expect(screen.getByTestId("campaign-unit-deps-B")).toBeInTheDocument();
  });

  it("does not fetch readiness for a collapsed or draft card", () => {
    readinessMock.mockResolvedValue({ status: "no-loop" });
    const qc = new QueryClient();
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <CampaignLaneCard campaign={CAMPAIGN} project={PROJECT} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(readinessMock).not.toHaveBeenCalled(); // collapsed by default
  });

  it("does not fetch readiness for a draft campaign", () => {
    readinessMock.mockResolvedValue({ status: "no-loop" });
    renderExpanded({ ...CAMPAIGN, status: "draft" });
    expect(readinessMock).not.toHaveBeenCalled();
  });

  it("a FAILED refetch keeps the last answer but says it may be out of date, and warns on launch", async () => {
    readinessMock.mockResolvedValueOnce(report([unit("A", "pending", true)])).mockRejectedValue(new Error("HTTP 500"));
    localStorage.setItem(`webui:campaign-card-collapsed:${SLUG}`, "false");
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <CampaignLaneCard campaign={CAMPAIGN} project={PROJECT} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await screen.findByTestId(`campaign-step-launch-${SLUG}-A`);
    await qc.refetchQueries({ queryKey: ["campaign-readiness", "p1", SLUG] });
    await waitFor(() => expect(screen.getByTestId(`campaign-readiness-banner-${SLUG}`)).toHaveTextContent("last known readiness"));
    fireEvent.click(screen.getByTestId(`campaign-step-launch-${SLUG}-A`));
    expect(await screen.findByTestId(`campaign-step-notice-${SLUG}`)).toHaveTextContent("Readiness not checked");
  });

  it("an unreachable readiness endpoint with no prior answer is an unavailable scheduler, not silence", async () => {
    readinessMock.mockRejectedValue(new Error("HTTP 500"));
    renderExpanded();
    expect(await screen.findByTestId(`campaign-readiness-banner-${SLUG}`)).toHaveTextContent("couldn't be reached");
    expect(screen.getByTestId(`campaign-step-launch-${SLUG}`)).toBeInTheDocument(); // fallback launch stays
  });

  it("a fail-open launch is never silent: the confirm dialog says readiness was not checked", async () => {
    readinessMock.mockResolvedValue({ status: "engine-unavailable", reason: "no uv" });
    // unavailable → no per-unit controls; the notice rides on any unit launch that IS offered
    // (a ready unit from an earlier verdict is impossible here), so assert the copy contract directly.
    const { uncheckedLaunchNotice } = await import("../../lib/campaignReadinessCopy");
    expect(uncheckedLaunchNotice({ status: "engine-unavailable", reason: "no uv" })).toMatch(/Readiness not checked/);
    expect(uncheckedLaunchNotice({ status: "failed", reason: "x" })).toMatch(/Readiness not checked/);
    expect(uncheckedLaunchNotice({ status: "no-loop" })).toBeNull();
    expect(uncheckedLaunchNotice(undefined)).toBeNull();
  });
});
