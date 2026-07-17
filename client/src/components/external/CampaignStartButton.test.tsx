import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { CampaignStartButton } from "./CampaignStartButton";
import type { Campaign } from "../../lib/campaignsApi";
import type { Project } from "../../types";
import * as api from "../../lib/campaignsApi";

const PROJECT: Project = {
  id: "p1", name: "proj", path: "/proj", profile: "node",
  status: "active", lastActive: "", createdAt: "",
};

const SLUG = "2026-07-10-demo";
function makeCampaign(o: Partial<Campaign> = {}): Campaign {
  return {
    slug: SLUG, intent: "do", branchStrategy: null, expandsTriage: null,
    status: "draft", steps: [], done: 0, total: 2, nextPending: null, ...o,
  };
}

function renderBtn(project: Project | null = PROJECT) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <CampaignStartButton campaign={makeCampaign()} project={project} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("CampaignStartButton (AC1 / AC3)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("disabled when no project is resolved", () => {
    renderBtn(null);
    expect(screen.getByTestId(`campaign-start-${SLUG}`)).toBeDisabled();
  });

  it("AC1: clicking Start calls the EXISTING startCampaign hook path with the slug", async () => {
    const spy = vi.spyOn(api, "startCampaign").mockResolvedValue({ ok: true, data: { slug: SLUG, status: "active" } });
    renderBtn();
    fireEvent.click(screen.getByTestId(`campaign-start-${SLUG}`));
    await waitFor(() => expect(spy).toHaveBeenCalledWith("p1", SLUG));
  });

  it("AC3: a 409 already-complete start surfaces a persistent Refresh notice (no Retry)", async () => {
    vi.spyOn(api, "startCampaign").mockResolvedValue({
      ok: false, status: 409, error: "campaign_already_complete",
    });
    renderBtn();
    fireEvent.click(screen.getByTestId(`campaign-start-${SLUG}`));
    const notice = await screen.findByTestId(`campaign-start-failure-${SLUG}`);
    expect(notice).toHaveAttribute("data-launch-failure-code", "campaign_already_complete");
    expect(screen.getByTestId(`campaign-start-failure-${SLUG}-refresh`)).toBeInTheDocument();
    expect(screen.queryByTestId(`campaign-start-failure-${SLUG}-retry`)).toBeNull();
  });

  it("AC3: a 503 lock start surfaces a Retry (genuinely transient)", async () => {
    vi.spyOn(api, "startCampaign").mockResolvedValue({
      ok: false, status: 503, error: "lock_unavailable",
    });
    renderBtn();
    fireEvent.click(screen.getByTestId(`campaign-start-${SLUG}`));
    expect(await screen.findByTestId(`campaign-start-failure-${SLUG}-retry`)).toBeInTheDocument();
  });

  it("AC3: a 422 no-writable-target start shows the fix, NO Retry", async () => {
    vi.spyOn(api, "startCampaign").mockResolvedValue({
      ok: false, status: 422, error: "no_writable_status_target",
    });
    renderBtn();
    fireEvent.click(screen.getByTestId(`campaign-start-${SLUG}`));
    await screen.findByTestId(`campaign-start-failure-${SLUG}`);
    expect(screen.queryByTestId(`campaign-start-failure-${SLUG}-retry`)).toBeNull();
  });
});
