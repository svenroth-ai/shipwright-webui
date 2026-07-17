import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import { CampaignAutonomousLaunchButton } from "./CampaignAutonomousLaunchButton";
import type { Campaign, CampaignStep } from "../../lib/campaignsApi";
import type { Project } from "../../types";

// ── mocks ────────────────────────────────────────────────────────────────
const launchMock = vi.fn();
vi.mock("../../hooks/useLaunchCampaign", () => ({
  useLaunchCampaign: () => launchMock,
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

function makeCampaign(o: Partial<Campaign> = {}): Campaign {
  return {
    slug: "2026-06-02-x", intent: "do", branchStrategy: "stacked",
    expandsTriage: null, status: "active",
    steps: [makeStep({ id: "B0", status: "complete" }), makeStep({ id: "B1", status: "pending" })],
    done: 1, total: 2, nextPending: { id: "B1", specPath: ".s/B1.md" }, ...o,
  };
}

function renderBtn(campaign: Campaign, project: Project | null = PROJECT) {
  return render(
    <MemoryRouter>
      <CampaignAutonomousLaunchButton campaign={campaign} project={project} />
    </MemoryRouter>,
  );
}

const SLUG = "2026-06-02-x";

describe("CampaignAutonomousLaunchButton", () => {
  beforeEach(() => {
    launchMock.mockReset();
    navigateMock.mockReset();
    launchMock.mockResolvedValue({ ok: true, taskId: "t-9", commands: {} });
  });

  it("AC-10: disabled when there is no pending step (done === total)", () => {
    renderBtn(makeCampaign({ done: 2, total: 2, steps: [makeStep({ status: "complete" })] }));
    expect(screen.getByTestId(`campaign-autonomous-launch-${SLUG}`)).toBeDisabled();
  });

  it("AC-10: disabled when no project is resolved", () => {
    renderBtn(makeCampaign(), null);
    expect(screen.getByTestId(`campaign-autonomous-launch-${SLUG}`)).toBeDisabled();
  });

  it("AC-4: disabled + relabeled 'Run attached' when a run is attached; dialog cannot open", () => {
    renderBtn(makeCampaign({ attachedRun: true }));
    const btn = screen.getByTestId(`campaign-autonomous-launch-${SLUG}`);
    expect(btn).toBeDisabled();
    expect(btn).toHaveTextContent("Run attached");
    // AC-4: an explanatory tooltip, not just a disabled button.
    expect(btn.getAttribute("title")).toMatch(/already attached/i);
    fireEvent.click(btn);
    expect(screen.queryByTestId(`campaign-autonomous-dialog-${SLUG}`)).toBeNull();
    expect(launchMock).not.toHaveBeenCalled();
  });

  it("AC-4: a non-attached campaign is unaffected (still 'Launch autonomous', enabled)", () => {
    renderBtn(makeCampaign({ attachedRun: false }));
    const btn = screen.getByTestId(`campaign-autonomous-launch-${SLUG}`);
    expect(btn).not.toBeDisabled();
    expect(btn).toHaveTextContent("Launch autonomous");
  });

  it("AC2: opens a confirm dialog showing the exact command + remaining steps + won't-ask-again; no launch on open", () => {
    renderBtn(makeCampaign());
    fireEvent.click(screen.getByTestId(`campaign-autonomous-launch-${SLUG}`));
    const dialog = screen.getByTestId(`campaign-autonomous-dialog-${SLUG}`);
    expect(dialog).toBeInTheDocument();
    expect(screen.getByTestId(`campaign-autonomous-command-${SLUG}`)).toHaveTextContent(
      `/shipwright-iterate --campaign ${SLUG} --autonomous`,
    );
    // AC2: lists the remaining sub-iterates by name AND says it won't ask again.
    const remaining = screen.getByTestId(`campaign-autonomous-remaining-${SLUG}`);
    expect(remaining).toHaveTextContent("B1");
    expect(dialog).toHaveTextContent(/will not ask again/i);
    expect(launchMock).not.toHaveBeenCalled();
  });

  it("AC-7: Cancel closes the dialog and never launches", async () => {
    renderBtn(makeCampaign());
    fireEvent.click(screen.getByTestId(`campaign-autonomous-launch-${SLUG}`));
    fireEvent.click(screen.getByTestId(`campaign-autonomous-cancel-${SLUG}`));
    await waitFor(() =>
      expect(screen.queryByTestId(`campaign-autonomous-dialog-${SLUG}`)).toBeNull(),
    );
    expect(launchMock).not.toHaveBeenCalled();
    expect(navigateMock).not.toHaveBeenCalled();
  });


  it("AC-7: confirm launches and navigates to the new TaskDetail on success", async () => {
    renderBtn(makeCampaign());
    fireEvent.click(screen.getByTestId(`campaign-autonomous-launch-${SLUG}`));
    fireEvent.click(screen.getByTestId(`campaign-autonomous-confirm-${SLUG}`));
    await waitFor(() => {
      expect(launchMock).toHaveBeenCalledWith({
        project: { id: "p1", path: "/proj" },
        slug: SLUG,
      });
      expect(navigateMock).toHaveBeenCalledWith("/tasks/t-9");
    });
  });

  it("AC-8: a clean campaign has no ack checkbox and confirm is enabled", () => {
    renderBtn(makeCampaign()); // B1 pending, not risky
    fireEvent.click(screen.getByTestId(`campaign-autonomous-launch-${SLUG}`));
    expect(screen.queryByTestId(`campaign-autonomous-ack-${SLUG}`)).toBeNull();
    expect(screen.getByTestId(`campaign-autonomous-confirm-${SLUG}`)).not.toBeDisabled();
  });

  it("AC-8: a risky pending step disables confirm until the ack checkbox is ticked", () => {
    renderBtn(
      makeCampaign({
        steps: [makeStep({ id: "B0", status: "complete" }), makeStep({ id: "B1", status: "pending", planFirst: true })],
      }),
    );
    fireEvent.click(screen.getByTestId(`campaign-autonomous-launch-${SLUG}`));
    // risky warning lists B1
    expect(screen.getByTestId(`campaign-autonomous-risky-${SLUG}`)).toHaveTextContent("B1");
    const confirm = screen.getByTestId(`campaign-autonomous-confirm-${SLUG}`);
    expect(confirm).toBeDisabled();
    fireEvent.click(screen.getByTestId(`campaign-autonomous-ack-${SLUG}`));
    expect(confirm).not.toBeDisabled();
  });

  it("AC-8: failed/escalated pending steps are flagged risky too", () => {
    renderBtn(
      makeCampaign({
        steps: [makeStep({ id: "B0", status: "complete" }), makeStep({ id: "B1", status: "failed" })],
      }),
    );
    fireEvent.click(screen.getByTestId(`campaign-autonomous-launch-${SLUG}`));
    expect(screen.getByTestId(`campaign-autonomous-risky-${SLUG}`)).toHaveTextContent("B1");
    expect(screen.getByTestId(`campaign-autonomous-confirm-${SLUG}`)).toBeDisabled();
  });

  it("AC3: a rejected launch surfaces a persistent failure notice and stays open", async () => {
    launchMock.mockResolvedValue({
      ok: false,
      reason: "launch_failed",
      detail: 'HTTP 400 /api/external/tasks/t/launch: {"error":"invalid_campaign_slug"}',
    });
    renderBtn(makeCampaign());
    fireEvent.click(screen.getByTestId(`campaign-autonomous-launch-${SLUG}`));
    fireEvent.click(screen.getByTestId(`campaign-autonomous-confirm-${SLUG}`));
    await waitFor(() => {
      expect(screen.getByTestId(`campaign-autonomous-failure-${SLUG}`)).toBeInTheDocument();
    });
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("guards against double-submit (one launch per confirm burst)", async () => {
    let resolve: (v: unknown) => void = () => {};
    launchMock.mockImplementation(() => new Promise((r) => (resolve = r)));
    renderBtn(makeCampaign());
    fireEvent.click(screen.getByTestId(`campaign-autonomous-launch-${SLUG}`));
    const confirm = screen.getByTestId(`campaign-autonomous-confirm-${SLUG}`);
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    resolve({ ok: true, taskId: "t-9", commands: {} });
    await waitFor(() => expect(navigateMock).toHaveBeenCalled());
    expect(launchMock).toHaveBeenCalledTimes(1);
  });
});
