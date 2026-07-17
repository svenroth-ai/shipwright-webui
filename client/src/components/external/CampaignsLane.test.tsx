import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import type { Campaign } from "../../lib/campaignsApi";

// Mock the data hook; keep the REAL selectors so this test covers the
// visible/dismissed split + toggle. Stub the card to isolate lane logic.
let campaignsData: Campaign[] = [];
vi.mock("../../hooks/useCampaigns", () => ({
  useCampaigns: () => ({ data: campaignsData }),
}));
vi.mock("./CampaignLaneCard", () => ({
  CampaignLaneCard: ({ campaign }: { campaign: Campaign }) => (
    <div data-testid={`card-${campaign.slug}`} data-dismissed={campaign.dismissed || undefined} />
  ),
}));

import { CampaignsLane } from "./CampaignsLane";

function makeCampaign(o: Partial<Campaign> = {}): Campaign {
  return {
    slug: "c", intent: "do", branchStrategy: "stacked", expandsTriage: null,
    status: "active", steps: [], done: 1, total: 3, nextPending: null, ...o,
  };
}

describe("CampaignsLane", () => {
  beforeEach(() => {
    campaignsData = [];
  });

  // @covers FR-01.61
  it("renders nothing when there are no visible and no dismissed campaigns", () => {
    campaignsData = [makeCampaign({ slug: "done", status: "complete", done: 3, total: 3 })];
    const { container } = render(<CampaignsLane projectId="p1" />);
    expect(container).toBeEmptyDOMElement();
  });

  // @covers FR-01.61
  it("shows visible cards and hides dismissed ones behind a counted toggle", () => {
    campaignsData = [
      makeCampaign({ slug: "live" }),
      makeCampaign({ slug: "ghost", dismissed: true }),
    ];
    render(<CampaignsLane projectId="p1" />);
    expect(screen.getByTestId("card-live")).toBeInTheDocument();
    expect(screen.queryByTestId("card-ghost")).toBeNull();
    const toggle = screen.getByTestId("campaigns-show-dismissed-toggle");
    expect(toggle).toHaveTextContent("1 erledigt");
  });

  // @covers FR-01.61
  it("reveals the dismissed list when the toggle is clicked", () => {
    campaignsData = [
      makeCampaign({ slug: "live" }),
      makeCampaign({ slug: "ghost", dismissed: true }),
    ];
    render(<CampaignsLane projectId="p1" />);
    fireEvent.click(screen.getByTestId("campaigns-show-dismissed-toggle"));
    expect(screen.getByTestId("card-ghost")).toBeInTheDocument();
    expect(screen.getByTestId("card-ghost")).toHaveAttribute("data-dismissed", "true");
  });

  // @covers FR-01.61
  it("still renders the lane (with the toggle) when only dismissed campaigns remain", () => {
    campaignsData = [makeCampaign({ slug: "ghost", dismissed: true })];
    render(<CampaignsLane projectId="p1" />);
    expect(screen.getByTestId("task-board-campaigns-lane")).toBeInTheDocument();
    expect(screen.getByTestId("campaigns-show-dismissed-toggle")).toHaveTextContent("1 erledigt");
  });

  // @covers FR-01.61
  it("AC1: a draft campaign now appears on the board (was Triage-only before A17)", () => {
    campaignsData = [makeCampaign({ slug: "planned", status: "draft", done: 0, total: 2 })];
    render(<CampaignsLane projectId="p1" />);
    expect(screen.getByTestId("card-planned")).toBeInTheDocument();
  });

  // @covers FR-01.61
  it("AC1: a dismissed draft is NOT surfaced (dismiss quittance still wins)", () => {
    campaignsData = [makeCampaign({ slug: "planned", status: "draft", dismissed: true })];
    const { container } = render(<CampaignsLane projectId="p1" />);
    expect(container).toBeEmptyDOMElement();
  });
});
