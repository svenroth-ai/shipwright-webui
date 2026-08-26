import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi, afterEach } from "vitest";

import { OrgDocViewerModal } from "./OrgDocViewerModal";
import { ApiError } from "../../lib/externalApi";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderModal(fetcher: () => Promise<string>, renderAs?: "markdown" | "json") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <OrgDocViewerModal
        open
        onOpenChange={vi.fn()}
        title="conventions.md"
        queryKey={["org-doc-viewer-test", Math.random()]}
        fetcher={fetcher}
        renderAs={renderAs}
      />
    </QueryClientProvider>,
  );
}

describe("OrgDocViewerModal", () => {
  it("shows a loading state before the fetch resolves", async () => {
    let resolve!: (v: string) => void;
    renderModal(() => new Promise<string>((r) => (resolve = r)));
    expect(screen.getByTestId("org-doc-viewer-loading")).toBeInTheDocument();
    resolve("# hi");
    await waitFor(() => expect(screen.queryByTestId("org-doc-viewer-loading")).not.toBeInTheDocument());
  });

  it("renders markdown content once loaded", async () => {
    renderModal(() => Promise.resolve("# Conventions"));
    await waitFor(() => expect(screen.getByText("Conventions")).toBeInTheDocument());
  });

  it("renders a not-found state on a 404, not the generic error state", async () => {
    renderModal(() => Promise.reject(new ApiError("not_found", 404, {})));
    await waitFor(() => expect(screen.getByTestId("org-doc-viewer-not-found")).toBeInTheDocument());
    expect(screen.getByText("conventions.md doesn't exist yet.")).toBeInTheDocument();
    expect(screen.queryByTestId("org-doc-viewer-error")).not.toBeInTheDocument();
  });

  it("renders the generic error state naming the failure on a non-404 error", async () => {
    renderModal(() => Promise.reject(new ApiError("upstream broken", 502, {})));
    await waitFor(() => expect(screen.getByTestId("org-doc-viewer-error")).toBeInTheDocument());
    expect(screen.getByText(/Couldn't load conventions.md: upstream broken/)).toBeInTheDocument();
  });

  it("renders a non-ApiError failure's message via the generic error state", async () => {
    renderModal(() => Promise.reject(new Error("network down")));
    await waitFor(() => expect(screen.getByTestId("org-doc-viewer-error")).toBeInTheDocument());
    expect(screen.getByText(/Couldn't load conventions.md: network down/)).toBeInTheDocument();
  });

  it("pretty-prints valid JSON when renderAs='json'", async () => {
    renderModal(() => Promise.resolve('{"a":1}'), "json");
    await waitFor(() => expect(screen.getByTestId("org-doc-viewer-json")).toBeInTheDocument());
    expect(screen.getByTestId("org-doc-viewer-json").textContent).toBe(JSON.stringify({ a: 1 }, null, 2));
  });

  it("falls back to the raw string when renderAs='json' but the content isn't valid JSON", async () => {
    renderModal(() => Promise.resolve("not json"), "json");
    await waitFor(() => expect(screen.getByTestId("org-doc-viewer-json")).toBeInTheDocument());
    expect(screen.getByTestId("org-doc-viewer-json").textContent).toBe("not json");
  });
});
