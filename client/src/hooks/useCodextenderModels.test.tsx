import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const getCodextenderModelsMock = vi.fn();
vi.mock("../lib/codextenderModelsApi", () => ({
  getCodextenderModels: () => getCodextenderModelsMock(),
}));

const useSettingsMock = vi.fn();
vi.mock("./useSettings", () => ({
  useSettings: () => useSettingsMock(),
}));

import { useCodextenderModels } from "./useCodextenderModels";

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

describe("useCodextenderModels — PR-review round 11 (port-keyed cache)", () => {
  afterEach(() => {
    getCodextenderModelsMock.mockReset();
    useSettingsMock.mockReset();
  });

  it("re-fetches when codextenderPort changes, instead of serving the previous port's cached list", async () => {
    useSettingsMock.mockReturnValue({ data: { codextenderPort: 4000 } });
    getCodextenderModelsMock.mockResolvedValue({
      status: "ok",
      models: [{ slug: "sol", display_name: "Sol" }],
    });
    const { result, rerender } = renderHook(() => useCodextenderModels(true), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.data?.models[0].slug).toBe("sol"));
    expect(getCodextenderModelsMock).toHaveBeenCalledTimes(1);

    // Port changed in Settings — still well within the 2-minute staleTime,
    // so without the port in the query key this would keep serving the
    // stale ("sol") list instead of re-fetching for the new proxy.
    useSettingsMock.mockReturnValue({ data: { codextenderPort: 4100 } });
    getCodextenderModelsMock.mockResolvedValue({
      status: "ok",
      models: [{ slug: "astra", display_name: "Astra" }],
    });
    rerender();

    await waitFor(() => expect(result.current.data?.models[0].slug).toBe("astra"));
    expect(getCodextenderModelsMock).toHaveBeenCalledTimes(2);
  });

  it("defaults to port 4000 (matching the server-side default) when settings haven't resolved a codextenderPort", async () => {
    useSettingsMock.mockReturnValue({ data: undefined });
    getCodextenderModelsMock.mockResolvedValue({ status: "ok", models: [] });
    renderHook(() => useCodextenderModels(true), { wrapper: wrapper() });
    await waitFor(() => expect(getCodextenderModelsMock).toHaveBeenCalledTimes(1));
  });

  it("is disabled (no fetch) when enabled=false", () => {
    useSettingsMock.mockReturnValue({ data: { codextenderPort: 4000 } });
    renderHook(() => useCodextenderModels(false), { wrapper: wrapper() });
    expect(getCodextenderModelsMock).not.toHaveBeenCalled();
  });
});
