/*
 * Adopt result: the Profile row is a REAL read-only scan of the chosen repo
 * (POST /api/adopt/scan); everything else stays labelled sample. The screen must
 * never claim more is live than is, and must keep the sample row when the scan
 * is unavailable.
 */

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { AdoptResult } from "./AdoptResult";

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function answer(body: unknown) {
  fetchMock.mockResolvedValue({ json: async () => body });
}
function mount(path: string | null) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AdoptResult path={path} dispatch={vi.fn()} onLaunch={vi.fn()} />
    </QueryClientProvider>,
  );
}
const found = () => screen.getByTestId("wizard-adopt-found").textContent ?? "";

// @covers FR-01.75
describe("Adopt result — live profile row", () => {
  it("shows the detected profile with its source and the discovery warnings", async () => {
    answer({
      status: "ok",
      profile: { matched: "my-stack", confidence: 0.9, source: "user", warnings: ["skipped broken-one: not valid JSON"] },
    });
    mount("C:\\work\\api");
    await waitFor(() => expect(screen.getByTestId("wizard-adopt-profile-live")).toBeTruthy());
    expect(found()).toContain("my-stack - one of your own profiles");
    expect(found()).not.toContain("vite-hono");
    expect(screen.getByTestId("wizard-adopt-profile-warnings").textContent).toContain("skipped broken-one");
    expect(screen.getByTestId("wizard-adopt-stub-note").textContent).toContain("Profile row is read live");
    expect(screen.getByTestId("wizard-adopt-stub-note").textContent).toContain("still samples");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ path: "C:\\work\\api" });
  });

  it("a 1.0-style answer (no source, no warnings) still renders", async () => {
    answer({ status: "ok", profile: { matched: "vite-hono", confidence: 0.8, source: null, warnings: [] } });
    mount("C:\\work\\api");
    await waitFor(() => expect(screen.getByTestId("wizard-adopt-profile-live")).toBeTruthy());
    expect(found()).toContain("vite-hono");
    expect(screen.queryByTestId("wizard-adopt-profile-warnings")).toBeNull();
  });

  it("keeps the sample row and says why when the scan is unavailable", async () => {
    answer({ status: "engine-unavailable", reason: "The Shipwright adopt tool isn't installed.", repairCommand: "x" });
    mount("C:\\work\\api");
    await waitFor(() => expect(screen.getByTestId("wizard-adopt-scan-note").textContent).toContain("adopt tool isn't installed"));
    expect(found()).toContain("vite-hono");
    expect(screen.queryByTestId("wizard-adopt-profile-live")).toBeNull();
    expect(screen.getByTestId("wizard-adopt-stub-note").textContent).toContain("Sample findings");
  });

  it("says a newer scan format is not understood instead of half-rendering it", async () => {
    answer({ status: "unsupported-schema", version: "2.0" });
    mount("C:\\work\\api");
    await waitFor(() => expect(screen.getByTestId("wizard-adopt-scan-note").textContent).toContain("newer Shipwright"));
    expect(screen.queryByTestId("wizard-adopt-profile-live")).toBeNull();
  });

  it("an unreachable server is a failure note, not a crash", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));
    mount("C:\\work\\api");
    await waitFor(() => expect(screen.getByTestId("wizard-adopt-scan-note").textContent).toContain("Couldn't read the profile live"));
  });

  it("never scans a remote URL or an empty path", () => {
    mount("github.com/acme/checkout");
    cleanup();
    mount(null);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
