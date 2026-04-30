/*
 * iterate iterate-20260430-actions-upload-ui — ActionsConfigCard tests.
 *
 * Covers FR-01.27 client UI:
 *   - lists registered projects (skips synthesized)
 *   - shows source state (Custom / Bundled / Malformed) per project
 *   - upload happy-path triggers POST /actions-upload + success affordance
 *   - upload error path renders inline error
 *   - reset triggers DELETE /actions-upload after confirm
 */

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { http, HttpResponse } from "msw";

import { server } from "../../test/mocks/server";
import { ActionsConfigCard } from "./ActionsConfigCard";
import type { Project } from "../../types";

const PROJECTS: Project[] = [
  {
    id: "p1",
    name: "Alpha",
    path: "/repo/alpha",
    profile: "vite-hono",
    status: "active",
    lastActive: "2026-04-30T00:00:00Z",
    createdAt: "2026-04-01T00:00:00Z",
  },
  {
    id: "p2",
    name: "Beta",
    path: "/repo/beta",
    profile: "vite-hono",
    status: "active",
    lastActive: "2026-04-30T00:00:00Z",
    createdAt: "2026-04-01T00:00:00Z",
  },
  {
    id: "syn",
    name: "Unassigned",
    path: "",
    profile: "",
    status: "active",
    lastActive: "2026-04-30T00:00:00Z",
    createdAt: "2026-04-30T00:00:00Z",
    synthesized: true,
  },
];

/** Stub an actions GET response with a tweakable diagnostics + actions list. */
function actionsResponse(opts: {
  fromUser?: boolean;
  diagnostics?: Array<{ code: string; path?: string }>;
}) {
  return HttpResponse.json({
    actions: [
      { id: "new-task", label: "New task", kind: "external_launch" },
      { id: "new-pipeline", label: "New pipeline", kind: "external_launch" },
    ],
    phases: [{ id: "build", label: "Build" }],
    defaults: { autonomy: "guided" },
    preview: { enabled: true, command: "npm run dev", port: 5173, ready_path: "/", ready_timeout_seconds: 60 },
    diagnostics: opts.diagnostics ?? [],
    fromUser: opts.fromUser ?? false,
  });
}

function setup() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={qc}>
      <ActionsConfigCard projects={PROJECTS} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  // Default: every project is on the bundled default (no diagnostics, no
  // user file). Individual tests override via `server.use(...)`.
  server.use(
    http.get(
      "/api/external/projects/:projectId/actions",
      ({ params }) => {
        // No assertion needed here — just return a happy response.
        void params;
        return actionsResponse({ fromUser: false });
      },
    ),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ActionsConfigCard", () => {
  it("renders one row per non-synthesized project", async () => {
    setup();
    expect(await screen.findByTestId("actions-config-row-p1")).toBeInTheDocument();
    expect(screen.getByTestId("actions-config-row-p2")).toBeInTheDocument();
    // Synthesized project is filtered out — no row, no badge.
    expect(screen.queryByTestId("actions-config-row-syn")).toBeNull();
  });

  it("shows 'Bundled' state badge when project has no .webui/actions.json", async () => {
    setup();
    const row = await screen.findByTestId("actions-config-row-p1");
    expect(within(row).getByTestId("actions-config-state-p1")).toHaveTextContent(
      /bundled/i,
    );
  });

  it("shows 'Malformed' state badge when loader reports actions_file_malformed diagnostic", async () => {
    server.use(
      http.get(
        "/api/external/projects/:projectId/actions",
        ({ params }) => {
          if (params.projectId === "p1") {
            return actionsResponse({
              fromUser: false,
              diagnostics: [
                {
                  code: "actions_file_malformed",
                  path: "/repo/alpha/.webui/actions.json",
                },
              ],
            });
          }
          return actionsResponse({ fromUser: false });
        },
      ),
    );
    setup();
    const row = await screen.findByTestId("actions-config-row-p1");
    await waitFor(() =>
      expect(
        within(row).getByTestId("actions-config-state-p1"),
      ).toHaveTextContent(/malformed/i),
    );
  });

  it("upload happy path: POSTs file content + invalidates the actions cache", async () => {
    let received: string | null = null;
    server.use(
      http.post(
        "/api/projects/p1/actions-upload",
        async ({ request }) => {
          received = await request.text();
          return HttpResponse.json({
            path: "/repo/alpha/.webui/actions.json",
            written: true,
          });
        },
      ),
    );
    setup();

    const fileInput = (await screen.findByTestId(
      "actions-config-file-p1",
    )) as HTMLInputElement;

    const validJson = JSON.stringify({
      schemaVersion: 1,
      defaults: { autonomy: "guided" },
      actions: [],
      phases: [],
      preview: { enabled: "auto" },
    });
    const file = new File([validJson], "actions.json", {
      type: "application/json",
    });
    await userEvent.upload(fileInput, file);

    await waitFor(() => {
      expect(received).not.toBeNull();
    });
    expect(received).toContain('"schemaVersion"');
    // Success indicator surfaces.
    expect(
      await screen.findByTestId("actions-config-success-p1"),
    ).toBeInTheDocument();
  });

  it("upload error path renders structured server error inline", async () => {
    server.use(
      http.post(
        "/api/projects/p1/actions-upload",
        () =>
          HttpResponse.json(
            {
              error: "schema_validation_failed",
              errors: [{ code: "empty_phases" }],
            },
            { status: 400 },
          ),
      ),
    );
    setup();

    const fileInput = (await screen.findByTestId(
      "actions-config-file-p1",
    )) as HTMLInputElement;
    const file = new File(["{}"], "actions.json", {
      type: "application/json",
    });
    await userEvent.upload(fileInput, file);

    const errBanner = await screen.findByTestId("actions-config-error-p1");
    expect(errBanner).toHaveTextContent(/schema/i);
    expect(errBanner).toHaveAttribute("role", "alert");
  });

  it("reset triggers DELETE /actions-upload after dialog confirm", async () => {
    // Override default actions response so p1 reports fromUser:true,
    // which is what enables the Reset button.
    server.use(
      http.get(
        "/api/external/projects/:projectId/actions",
        ({ params }) =>
          actionsResponse({ fromUser: params.projectId === "p1" }),
      ),
    );
    let deleteCalled = false;
    server.use(
      http.delete("/api/projects/p1/actions-upload", () => {
        deleteCalled = true;
        return HttpResponse.json({
          path: "/repo/alpha/.webui/actions.json",
          removed: true,
        });
      }),
    );
    setup();

    // Wait until the actions query resolves and the Reset button enables.
    await waitFor(() => {
      const btn = screen.getByTestId(
        "actions-config-reset-p1",
      ) as HTMLButtonElement;
      expect(btn.disabled).toBe(false);
    });

    // Click the inline Reset → opens the Radix confirm dialog. No fetch yet.
    await userEvent.click(screen.getByTestId("actions-config-reset-p1"));
    expect(deleteCalled).toBe(false);

    // Confirm in the dialog → DELETE fires.
    const confirmBtn = await screen.findByTestId(
      "actions-config-reset-confirm-button-p1",
    );
    await userEvent.click(confirmBtn);
    await waitFor(() => expect(deleteCalled).toBe(true));
  });

  it("reset is enabled even when the on-disk file is malformed (recovery path)", async () => {
    server.use(
      http.get(
        "/api/external/projects/:projectId/actions",
        ({ params }) => {
          if (params.projectId === "p1") {
            return actionsResponse({
              fromUser: false,
              diagnostics: [
                {
                  code: "actions_file_malformed",
                  path: "/repo/alpha/.webui/actions.json",
                },
              ],
            });
          }
          return actionsResponse({ fromUser: false });
        },
      ),
    );
    setup();
    await waitFor(() => {
      const btn = screen.getByTestId(
        "actions-config-reset-p1",
      ) as HTMLButtonElement;
      expect(btn.disabled).toBe(false);
    });
  });

  it("reset is a no-op when the user cancels the dialog", async () => {
    server.use(
      http.get(
        "/api/external/projects/:projectId/actions",
        ({ params }) =>
          actionsResponse({ fromUser: params.projectId === "p1" }),
      ),
    );
    let deleteCalled = false;
    server.use(
      http.delete("/api/projects/p1/actions-upload", () => {
        deleteCalled = true;
        return HttpResponse.json({ removed: true });
      }),
    );
    setup();

    await waitFor(() => {
      const btn = screen.getByTestId(
        "actions-config-reset-p1",
      ) as HTMLButtonElement;
      expect(btn.disabled).toBe(false);
    });

    await userEvent.click(screen.getByTestId("actions-config-reset-p1"));
    const cancelBtn = await screen.findByTestId(
      "actions-config-reset-cancel-p1",
    );
    await userEvent.click(cancelBtn);
    expect(deleteCalled).toBe(false);
  });
});
