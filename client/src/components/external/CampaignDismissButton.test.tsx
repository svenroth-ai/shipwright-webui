import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { CampaignDismissButton } from "./CampaignDismissButton";
import type { Campaign } from "../../lib/campaignsApi";
import type { Project } from "../../types";

// Mock the mutation hook directly (sibling pattern: CampaignAutonomousLaunchButton).
const mutateMock = vi.fn();
let pending = false;
vi.mock("../../hooks/useDismissCampaign", () => ({
  useDismissCampaign: () => ({ mutate: mutateMock, isPending: pending }),
}));

const PROJECT: Project = {
  id: "p1", name: "proj", path: "/proj", profile: "node",
  status: "active", lastActive: "", createdAt: "",
};

function makeCampaign(o: Partial<Campaign> = {}): Campaign {
  return {
    slug: "2026-06-07-x", intent: "do", branchStrategy: "stacked",
    expandsTriage: null, status: null, steps: [],
    done: 4, total: 4, nextPending: null, derivedFromEvents: true, ...o,
  };
}

const SLUG = "2026-06-07-x";

describe("CampaignDismissButton", () => {
  beforeEach(() => {
    mutateMock.mockReset();
    pending = false;
  });

  it("renders a dismiss control and dismisses an active card on click", () => {
    render(<CampaignDismissButton campaign={makeCampaign({ dismissed: false })} project={PROJECT} />);
    const btn = screen.getByTestId(`campaign-dismiss-${SLUG}`);
    expect(btn).not.toHaveAttribute("data-dismissed");
    expect(btn.getAttribute("aria-label")).toMatch(/erledigt/i);
    fireEvent.click(btn);
    expect(mutateMock).toHaveBeenCalledWith({ slug: SLUG, dismissed: false });
  });

  it("renders a restore control and restores a dismissed card on click", () => {
    render(<CampaignDismissButton campaign={makeCampaign({ dismissed: true })} project={PROJECT} />);
    const btn = screen.getByTestId(`campaign-dismiss-${SLUG}`);
    expect(btn).toHaveAttribute("data-dismissed", "true");
    expect(btn.getAttribute("aria-label")).toMatch(/wiederherstellen/i);
    fireEvent.click(btn);
    expect(mutateMock).toHaveBeenCalledWith({ slug: SLUG, dismissed: true });
  });

  it("renders nothing without a resolved project (action is keyed by projectId)", () => {
    const { container } = render(
      <CampaignDismissButton campaign={makeCampaign()} project={null} />,
    );
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByTestId(`campaign-dismiss-${SLUG}`)).toBeNull();
  });

  it("is disabled while the mutation is pending", () => {
    pending = true;
    render(<CampaignDismissButton campaign={makeCampaign()} project={PROJECT} />);
    expect(screen.getByTestId(`campaign-dismiss-${SLUG}`)).toBeDisabled();
  });
});
