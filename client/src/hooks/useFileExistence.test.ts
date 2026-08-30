import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";

import { useFileExistence } from "./useFileExistence";
import * as fileExistsApi from "../lib/fileExistsApi";

vi.mock("../lib/fileExistsApi", () => ({ checkFilesExist: vi.fn() }));
const mockedCheck = vi.mocked(fileExistsApi.checkFilesExist);

let qc: QueryClient;
beforeEach(() => {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.clearAllMocks();
});

function wrapper({ children }: { children: ReactNode }) {
  return createElement(QueryClientProvider, { client: qc }, children);
}

describe("useFileExistence", () => {
  it("returns an empty Set immediately (no network call) for zero paths", () => {
    const { result } = renderHook(() => useFileExistence("p-1", []), { wrapper });
    expect(result.current).toEqual(new Set());
    expect(mockedCheck).not.toHaveBeenCalled();
  });

  it("returns null (not yet known) before the check resolves, then only the existing paths", async () => {
    mockedCheck.mockResolvedValue({ "a.md": true, "b.json": false });
    const { result } = renderHook(
      () => useFileExistence("p-1", ["a.md", "b.json"]),
      { wrapper },
    );
    expect(result.current).toBeNull();

    await waitFor(() => expect(result.current).not.toBeNull());
    expect(result.current).toEqual(new Set(["a.md"]));
  });

  it("stays null (never renders a link) when the existence check fails", async () => {
    mockedCheck.mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useFileExistence("p-1", ["a.md"]), { wrapper });

    await waitFor(() => expect(mockedCheck).toHaveBeenCalled());
    // React Query settles the failed query; give it a tick to reach "error".
    await new Promise((r) => setTimeout(r, 10));
    expect(result.current).toBeNull();
  });

  it("caps the batch at 50 distinct paths instead of sending an over-cap request that 400s entirely", async () => {
    mockedCheck.mockResolvedValue({});
    const manyPaths = Array.from({ length: 75 }, (_, i) => `file-${i}.md`);
    renderHook(() => useFileExistence("p-1", manyPaths), { wrapper });

    await waitFor(() => expect(mockedCheck).toHaveBeenCalled());
    const [, sentPaths] = mockedCheck.mock.calls[0];
    expect(sentPaths).toHaveLength(50);
  });
});
