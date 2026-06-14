/*
 * iterate-2026-06-14-actions-config-ux — SettingsPage tests.
 *
 * The stale "Launcher preferences" stub card was removed (it described a
 * "Copy command launcher" that no longer exists). The page now hosts only
 * the actions-config surface.
 */

import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, beforeEach } from "vitest";
import { http, HttpResponse } from "msw";

import { server } from "../test/mocks/server";
import SettingsPage from "./SettingsPage";

function renderPage() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <SettingsPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  // Empty project list → ActionsConfigCard renders its empty-state, no rows,
  // so no per-project actions GET is needed. apiFetch unwraps `.data`, so the
  // response must be `{ data: [...] }`.
  server.use(http.get("/api/projects", () => HttpResponse.json({ data: [] })));
});

describe("SettingsPage", () => {
  it("no longer renders the stale 'Launcher preferences' card", async () => {
    renderPage();
    expect(await screen.findByTestId("settings-page")).toBeInTheDocument();
    expect(screen.queryByText("Launcher preferences")).toBeNull();
  });

  it("renders the actions-config surface", async () => {
    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId("settings-configure-actions")).toBeInTheDocument(),
    );
    expect(screen.getByText("Configure actions")).toBeInTheDocument();
  });

  it("still maps real projects to actions rows (full header) after the extraction", async () => {
    // Guards the behavior-preserving extraction: the Settings card must keep
    // rendering one ActionsConfigRow per real project, in FULL mode (name +
    // path visible — NOT the modal's compact mode).
    // apiFetch unwraps `.data`, so /api/projects must return `{ data: [...] }`.
    server.use(
      http.get("/api/projects", () =>
        HttpResponse.json({
          data: [
            {
              id: "pX",
              name: "Gamma Repo",
              path: "/repo/gamma",
              profile: "vite-hono",
              status: "active",
              lastActive: "2026-06-14T00:00:00Z",
              createdAt: "2026-06-01T00:00:00Z",
            },
          ],
        }),
      ),
      http.get("/api/external/projects/:projectId/actions", () =>
        HttpResponse.json({
          actions: [],
          phases: [{ id: "build", label: "Build" }],
          defaults: { autonomy: "guided" },
          preview: { enabled: false, command: null, port: null, ready_path: null, ready_timeout_seconds: null },
          diagnostics: [],
          fromUser: false,
        }),
      ),
    );
    renderPage();
    expect(await screen.findByTestId("actions-config-row-pX")).toBeInTheDocument();
    // Full header on Settings: name + path are shown (not hidden like the modal).
    expect(screen.getByText("Gamma Repo")).toBeInTheDocument();
    expect(screen.getByText("/repo/gamma")).toBeInTheDocument();
    expect(screen.getByText("Upload .json")).toBeInTheDocument();
  });
});
