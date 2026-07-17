import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import { CampaignLaunchDialog, type CampaignLaunchDialogProps } from "./CampaignLaunchDialog";
import { resolveLaunchFailure } from "../../lib/launchFailure";
import type { CampaignStep } from "../../lib/campaignsApi";

function step(id: string, title: string, status: CampaignStep["status"] = "pending"): CampaignStep {
  return { id, slug: id.toLowerCase(), title, status, specPath: `.s/${id}.md`, commit: null, branch: null, planFirst: false };
}

function renderDialog(props: Partial<CampaignLaunchDialogProps> = {}) {
  const onConfirm = vi.fn();
  render(
    <MemoryRouter>
      <CampaignLaunchDialog
        open
        onOpenChange={() => {}}
        slug="camp"
        testIdPrefix="campaign-step"
        variant="step"
        title="Launch sub-iterate B1"
        command={'/shipwright-iterate ".s/B1.md"'}
        what={{ stepId: "B1", stepTitle: "Beta", specPath: ".s/B1.md" }}
        where={{ projectName: "Proj", cwd: "/home/proj" }}
        submitting={false}
        confirmLabel="Launch"
        onConfirm={onConfirm}
        {...props}
      />
    </MemoryRouter>,
  );
  return { onConfirm };
}

describe("CampaignLaunchDialog (AC2)", () => {
  it("shows WHAT (step · title · spec path), WHERE (project · cwd), and the verbatim command", () => {
    renderDialog();
    expect(screen.getByTestId("campaign-step-what-camp")).toHaveTextContent("B1");
    expect(screen.getByTestId("campaign-step-what-camp")).toHaveTextContent(".s/B1.md");
    expect(screen.getByTestId("campaign-step-where-camp")).toHaveTextContent("Proj");
    expect(screen.getByTestId("campaign-step-where-camp")).toHaveTextContent("/home/proj");
    expect(screen.getByTestId("campaign-step-command-camp")).toHaveTextContent('/shipwright-iterate ".s/B1.md"');
  });

  it("confirm fires onConfirm; the dialog itself creates nothing", () => {
    const { onConfirm } = renderDialog();
    fireEvent.click(screen.getByTestId("campaign-step-confirm-camp"));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("autonomous variant lists the remaining sub-iterates by name + says it won't ask again", () => {
    renderDialog({
      variant: "autonomous",
      testIdPrefix: "campaign-autonomous",
      title: "Launch autonomous campaign",
      command: "/shipwright-iterate --campaign camp --autonomous",
      remaining: [step("B1", "Beta"), step("B2", "Gamma")],
    });
    const remaining = screen.getByTestId("campaign-autonomous-remaining-camp");
    expect(remaining).toHaveTextContent("B1");
    expect(remaining).toHaveTextContent("B2");
    expect(remaining).toHaveTextContent(/will not ask again/i);
  });

  it("a risky pending step gates confirm behind the ack (confirmDisabled)", () => {
    renderDialog({
      variant: "autonomous",
      testIdPrefix: "campaign-autonomous",
      risky: [step("B1", "Beta", "failed")],
      confirmDisabled: true,
    });
    expect(screen.getByTestId("campaign-autonomous-risky-camp")).toHaveTextContent("B1");
    expect(screen.getByTestId("campaign-autonomous-confirm-camp")).toBeDisabled();
  });

  it("renders a failure notice (with retry) when a launch was rejected", () => {
    const onRetry = vi.fn();
    renderDialog({
      failure: resolveLaunchFailure({ source: "task", state: "launch_failed" }),
      onRetry,
      onCopyCommand: () => {},
    });
    expect(screen.getByTestId("campaign-step-failure-camp")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("campaign-step-failure-camp-retry"));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
