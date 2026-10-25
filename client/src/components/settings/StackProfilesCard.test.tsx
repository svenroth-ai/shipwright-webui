/** @covers FR-01.75 — Settings card: source grouping, invalid warning, create. */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { StackProfilesCard } from "./StackProfilesCard";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const entry = (name: string, source: string, valid = true, error: string | null = null) => ({
  name, source, path: `/x/${name}.json`, valid, error, kind: null, schema_version: 1, description: `${name} desc`, shadows: [],
});
const report = (profiles: unknown[]) => ({
  status: "ok",
  report: { contract_version: 1, profiles, warnings: ["user dir missing"], searched: [] },
});

function mockFetch(handler: (url: string, init?: RequestInit) => unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const body = handler(String(url), init) as { __status?: number };
      return { ok: true, status: body.__status ?? 200, json: async () => body, text: async () => "" };
    }),
  );
}
const renderCard = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <StackProfilesCard projects={[{ id: "p1", name: "Proj" }]} />
    </QueryClientProvider>,
  );

describe("StackProfilesCard", () => {
  // @covers FR-01.75
  it("groups by source, flags an invalid profile and shows resolver warnings", async () => {
    mockFetch(() => report([entry("mine", "user"), entry("broken", "user", false, "not valid JSON"), entry("vite-hono", "bundled")]));
    renderCard();
    expect(await screen.findByTestId("stack-profiles-group-user")).toBeInTheDocument();
    expect(screen.getByTestId("stack-profiles-group-bundled")).toBeInTheDocument();
    expect(screen.queryByTestId("stack-profiles-group-project")).toBeNull();
    expect(screen.getByTestId("stack-profile-invalid-broken")).toHaveTextContent("not valid JSON");
    expect(screen.getByTestId("stack-profiles-warnings")).toHaveTextContent("user dir missing");
  });

  // @covers FR-01.75
  it("says so plainly when the resolver isn't installed", async () => {
    mockFetch(() => ({ status: "engine-unavailable", reason: "The Shipwright profile resolver isn't installed.", repairCommand: "npx x" }));
    renderCard();
    expect(await screen.findByTestId("stack-profiles-unavailable")).toHaveTextContent("npx x");
  });

  // @covers FR-01.75
  it("creates a copy of a built-in profile and shows the reason when it is refused", async () => {
    let created = false;
    mockFetch((_url, init) => {
      if (init?.method === "POST") {
        return created
          ? { status: "exists", reason: "A profile called “mine” already exists." }
          : ((created = true), { status: "created", name: "mine", path: "/home/mine.json" });
      }
      return report([entry("vite-hono", "bundled")]);
    });
    renderCard();
    await screen.findByTestId("stack-profiles-create");
    fireEvent.change(screen.getByTestId("stack-profiles-name"), { target: { value: "mine" } });
    fireEvent.click(screen.getByTestId("stack-profiles-create-btn"));
    await waitFor(() => expect(screen.getByTestId("stack-profiles-message")).toHaveTextContent("Created “mine”"));
    fireEvent.change(screen.getByTestId("stack-profiles-name"), { target: { value: "mine" } });
    fireEvent.click(screen.getByTestId("stack-profiles-create-btn"));
    await waitFor(() => expect(screen.getByTestId("stack-profiles-message")).toHaveTextContent("already exists"));
  });
});
