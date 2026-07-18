/*
 * iterate-2026-06-14-actions-config-ux — ActionsConfigRow tests.
 *
 * The row was extracted from ActionsConfigCard so the project edit modal can
 * reuse it. New behavior under test: the `hideProjectHeader` flag (compact
 * mode for the modal — drops the redundant project name + path, keeps the
 * state badge + Upload/Reset controls).
 */

import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, beforeEach } from "vitest";
import { http, HttpResponse } from "msw";

import { server } from "../../test/mocks/server";
import { ActionsConfigRow } from "./ActionsConfigRow";
import type { Project } from "../../types";

const PROJECT: Project = {
  id: "p1",
  name: "Alpha Project",
  path: "/repo/alpha",
  profile: "vite-hono",
  status: "active",
  lastActive: "2026-06-14T00:00:00Z",
  createdAt: "2026-06-01T00:00:00Z",
};

function renderRow(props: { hideProjectHeader?: boolean }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <ActionsConfigRow project={PROJECT} {...props} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  server.use(
    http.get("/api/external/projects/:projectId/actions", () =>
      HttpResponse.json({
        actions: [],
        phases: [{ id: "build", label: "Build" }],
        defaults: { autonomy: "guided" },
        preview: { enabled: false, command: null, port: null, ready_path: null, ready_timeout_seconds: null },
        diagnostics: [],
        fromUser: true,
      }),
    ),
  );
});

describe("ActionsConfigRow", () => {
  // @covers FR-01.27
  it("renders the project name + path by default (Settings page layout)", async () => {
    renderRow({});
    expect(await screen.findByTestId("actions-config-row-p1")).toBeInTheDocument();
    expect(screen.getByText("Alpha Project")).toBeInTheDocument();
    expect(screen.getByText("/repo/alpha")).toBeInTheDocument();
    // Controls present in both modes.
    expect(screen.getByText("Upload .json")).toBeInTheDocument();
    expect(screen.getByTestId("actions-config-reset-p1")).toBeInTheDocument();
  });

  // @covers FR-01.27
  it("hideProjectHeader omits the name + path but keeps badge + controls", async () => {
    renderRow({ hideProjectHeader: true });
    expect(await screen.findByTestId("actions-config-row-p1")).toBeInTheDocument();
    // Redundant project header is gone in compact mode.
    expect(screen.queryByText("Alpha Project")).toBeNull();
    expect(screen.queryByText("/repo/alpha")).toBeNull();
    // Badge + controls remain.
    expect(screen.getByTestId("actions-config-state-p1")).toBeInTheDocument();
    expect(screen.getByText("Upload .json")).toBeInTheDocument();
    expect(screen.getByTestId("actions-config-reset-p1")).toBeInTheDocument();
  });

  // @covers FR-01.27
  it("shows the Custom badge once the actions query resolves with fromUser", async () => {
    renderRow({ hideProjectHeader: true });
    await waitFor(() =>
      expect(screen.getByTestId("actions-config-state-p1")).toHaveTextContent("Custom"),
    );
  });
});
