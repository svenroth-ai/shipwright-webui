import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi, afterEach } from "vitest";

import { OrgSharedDocs } from "./OrgSharedDocs";
import { fetchOrgChart, fetchOrgFileText } from "../../lib/orgApi";

vi.mock("../../lib/orgApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/orgApi")>();
  return { ...actual, fetchOrgChart: vi.fn(), fetchOrgFileText: vi.fn() };
});

const mockedFetchOrgChart = vi.mocked(fetchOrgChart);
const mockedFetchOrgFileText = vi.mocked(fetchOrgFileText);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderTiles() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <OrgSharedDocs />
    </QueryClientProvider>,
  );
}

describe("OrgSharedDocs", () => {
  it("renders all four document tiles", () => {
    renderTiles();
    expect(screen.getByTestId("org-shared-doc-view-org-chart.json")).toBeInTheDocument();
    expect(screen.getByTestId("org-shared-doc-view-conventions.md")).toBeInTheDocument();
    expect(screen.getByTestId("org-shared-doc-view-principal.md")).toBeInTheDocument();
    expect(screen.getByTestId("org-shared-doc-view-decision_log.md")).toBeInTheDocument();
  });

  it("opens the markdown viewer for a markdown tile and fetches its text", async () => {
    mockedFetchOrgFileText.mockResolvedValue("# Conventions body");
    renderTiles();

    fireEvent.click(screen.getByTestId("org-shared-doc-view-conventions.md"));

    await waitFor(() => expect(screen.getByTestId("org-doc-viewer-modal")).toBeInTheDocument());
    expect(mockedFetchOrgFileText).toHaveBeenCalledWith("conventions.md");
    await waitFor(() => expect(screen.getByText("Conventions body")).toBeInTheDocument());
  });

  it("opens the JSON viewer for org-chart.json, stringifying the chart via fetchOrgChart", async () => {
    mockedFetchOrgChart.mockResolvedValue({ version: 1, po: "sven", leads: {} });
    renderTiles();

    fireEvent.click(screen.getByTestId("org-shared-doc-view-org-chart.json"));

    await waitFor(() => expect(screen.getByTestId("org-doc-viewer-json")).toBeInTheDocument());
    expect(mockedFetchOrgChart).toHaveBeenCalled();
    expect(mockedFetchOrgFileText).not.toHaveBeenCalled();
  });

  it("opens the markdown viewer for decision_log.md and fetches its text", async () => {
    mockedFetchOrgFileText.mockResolvedValue("# Decision log body");
    renderTiles();

    fireEvent.click(screen.getByTestId("org-shared-doc-view-decision_log.md"));

    await waitFor(() => expect(screen.getByTestId("org-doc-viewer-modal")).toBeInTheDocument());
    expect(mockedFetchOrgFileText).toHaveBeenCalledWith("decision_log.md");
  });

  it("closing the modal via onOpenChange unmounts it", async () => {
    mockedFetchOrgFileText.mockResolvedValue("body");
    renderTiles();

    fireEvent.click(screen.getByTestId("org-shared-doc-view-principal.md"));
    await waitFor(() => expect(screen.getByTestId("org-doc-viewer-modal")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("org-doc-viewer-close"));
    await waitFor(() => expect(screen.queryByTestId("org-doc-viewer-modal")).not.toBeInTheDocument());
  });
});
