import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { CampaignStepLaunchButton } from "./CampaignStepLaunchButton";
import type { Campaign, CampaignStep } from "../../lib/campaignsApi";
import type { Project } from "../../types";

// ── mocks ────────────────────────────────────────────────────────────────
const launchStepMock = vi.fn();
vi.mock("../../hooks/useLaunchCampaignStep", () => ({
  useLaunchCampaignStep: () => launchStepMock,
}));
const navigateMock = vi.fn();
vi.mock("react-router-dom", async (orig) => ({
  ...(await orig<typeof import("react-router-dom")>()),
  useNavigate: () => navigateMock,
}));

function makeStep(o: Partial<CampaignStep> = {}): CampaignStep {
  return {
    id: "B0", slug: "x", title: "X", status: "pending",
    specPath: ".s/B0-x.md", commit: null, branch: null, planFirst: false, ...o,
  };
}

const PROJECT: Project = {
  id: "p1", name: "proj", path: "/proj", profile: "node",
  status: "active", lastActive: "", createdAt: "",
};

const SLUG = "2026-06-02-x";

function makeCampaign(o: Partial<Campaign> = {}): Campaign {
  return {
    slug: SLUG, intent: "do", branchStrategy: "stacked",
    expandsTriage: null, status: "active",
    steps: [makeStep({ id: "B0", status: "complete" }), makeStep({ id: "B1", status: "pending" })],
    done: 1, total: 2, nextPending: { id: "B1", specPath: ".s/B1-x.md" }, ...o,
  };
}

function renderBtn(campaign: Campaign, project: Project | null = PROJECT) {
  return render(<CampaignStepLaunchButton campaign={campaign} project={project} />);
}

describe("CampaignStepLaunchButton", () => {
  beforeEach(() => {
    launchStepMock.mockReset();
    navigateMock.mockReset();
    launchStepMock.mockResolvedValue({ ok: true, taskId: "t-9", commands: {} });
  });

  // ---- AC4: disabled states (never a dead button without reason) ----

  it("AC4: disabled when there is no pending next step", () => {
    renderBtn(makeCampaign({ done: 2, total: 2, nextPending: null }));
    expect(screen.getByTestId(`campaign-step-launch-${SLUG}`)).toBeDisabled();
  });

  it("AC4: disabled when the next-pending spec path is null", () => {
    renderBtn(makeCampaign({ nextPending: { id: "B1", specPath: null } }));
    expect(screen.getByTestId(`campaign-step-launch-${SLUG}`)).toBeDisabled();
  });

  it("AC4: disabled when no project is resolved", () => {
    renderBtn(makeCampaign(), null);
    expect(screen.getByTestId(`campaign-step-launch-${SLUG}`)).toBeDisabled();
  });

  it("AC-5: disabled + relabeled 'Run attached' when a run is attached; clicking never launches", () => {
    renderBtn(makeCampaign({ attachedRun: true }));
    const btn = screen.getByTestId(`campaign-step-launch-${SLUG}`);
    expect(btn).toBeDisabled();
    expect(btn).toHaveTextContent("Run attached");
    expect(btn.getAttribute("title")).toMatch(/already attached/i);
    fireEvent.click(btn);
    expect(screen.queryByTestId(`campaign-step-dialog-${SLUG}`)).toBeNull();
    expect(launchStepMock).not.toHaveBeenCalled();
  });

  it("AC-5: attachedRun also blocks the RISKY-step dialog path (no confirm dialog opens)", () => {
    // A risky next step would normally open the confirm dialog — but an attached
    // run must take precedence and keep the button disabled, so neither the
    // direct launch nor the dialog path is reachable.
    renderBtn(
      makeCampaign({
        attachedRun: true,
        steps: [makeStep({ id: "B0", status: "complete" }), makeStep({ id: "B1", status: "failed" })],
        nextPending: { id: "B1", specPath: ".s/B1-x.md" },
      }),
    );
    const btn = screen.getByTestId(`campaign-step-launch-${SLUG}`);
    expect(btn).toBeDisabled();
    expect(btn).toHaveTextContent("Run attached");
    fireEvent.click(btn);
    expect(screen.queryByTestId(`campaign-step-dialog-${SLUG}`)).toBeNull();
    expect(launchStepMock).not.toHaveBeenCalled();
  });

  it("AC4: labels the button with the next-pending step id", () => {
    renderBtn(makeCampaign());
    expect(screen.getByTestId(`campaign-step-launch-${SLUG}`)).toHaveTextContent("Launch (B1)");
  });

  // ---- AC5: direct launch for an ordinary (non-risky) step ----

  it("AC5: clicking an ordinary next step launches directly (no dialog) and navigates", async () => {
    renderBtn(makeCampaign());
    fireEvent.click(screen.getByTestId(`campaign-step-launch-${SLUG}`));
    await waitFor(() =>
      expect(launchStepMock).toHaveBeenCalledWith({
        project: { id: "p1", path: "/proj" },
        slug: SLUG,
        stepId: "B1",
      }),
    );
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith("/tasks/t-9"));
    // no confirm dialog was opened
    expect(screen.queryByTestId(`campaign-step-dialog-${SLUG}`)).toBeNull();
  });

  it("AC5: surfaces an inline error when the launch fails", async () => {
    launchStepMock.mockResolvedValue({ ok: false, reason: "launch_failed", detail: "campaign_step_spec_missing" });
    renderBtn(makeCampaign());
    fireEvent.click(screen.getByTestId(`campaign-step-launch-${SLUG}`));
    expect(await screen.findByTestId(`campaign-step-error-${SLUG}`)).toHaveTextContent("campaign_step_spec_missing");
    expect(navigateMock).not.toHaveBeenCalled();
  });

  // ---- AC6: confirm dialog only for a risky next step ----

  it("AC6: a risky (failed) next step opens a confirm dialog instead of launching", () => {
    renderBtn(makeCampaign({
      steps: [makeStep({ id: "B0", status: "complete" }), makeStep({ id: "B1", status: "failed" })],
      nextPending: { id: "B1", specPath: ".s/B1-x.md" },
    }));
    fireEvent.click(screen.getByTestId(`campaign-step-launch-${SLUG}`));
    expect(screen.getByTestId(`campaign-step-dialog-${SLUG}`)).toBeInTheDocument();
    expect(launchStepMock).not.toHaveBeenCalled();
  });

  it("AC6: confirming the risky dialog launches + navigates", async () => {
    renderBtn(makeCampaign({
      steps: [makeStep({ id: "B0", status: "complete" }), makeStep({ id: "B1", status: "escalated" })],
      nextPending: { id: "B1", specPath: ".s/B1-x.md" },
    }));
    fireEvent.click(screen.getByTestId(`campaign-step-launch-${SLUG}`));
    fireEvent.click(screen.getByTestId(`campaign-step-confirm-${SLUG}`));
    await waitFor(() =>
      expect(launchStepMock).toHaveBeenCalledWith({
        project: { id: "p1", path: "/proj" },
        slug: SLUG,
        stepId: "B1",
      }),
    );
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith("/tasks/t-9"));
  });

  it("AC6: fail-safe — a next-pending id missing from steps opens the dialog (no direct launch)", () => {
    // nextPending points at B9 which is absent from `steps` (data race / edge).
    renderBtn(makeCampaign({
      steps: [makeStep({ id: "B0", status: "complete" })],
      nextPending: { id: "B9", specPath: ".s/B9-x.md" },
    }));
    fireEvent.click(screen.getByTestId(`campaign-step-launch-${SLUG}`));
    expect(screen.getByTestId(`campaign-step-dialog-${SLUG}`)).toBeInTheDocument();
    expect(launchStepMock).not.toHaveBeenCalled();
  });

  it("AC6: a plan-first next step is also gated by the dialog", () => {
    renderBtn(makeCampaign({
      steps: [makeStep({ id: "B0", status: "complete" }), makeStep({ id: "B1", status: "pending", planFirst: true })],
      nextPending: { id: "B1", specPath: ".s/B1-x.md" },
    }));
    fireEvent.click(screen.getByTestId(`campaign-step-launch-${SLUG}`));
    expect(screen.getByTestId(`campaign-step-dialog-${SLUG}`)).toBeInTheDocument();
    expect(launchStepMock).not.toHaveBeenCalled();
  });
});
