/*
 * Unit tests for CreateControls — the Task Board header right-cluster wrapper
 * (iterate-2026-06-02-all-projects-create-cascade).
 *
 * CreateControls branches on `activeProjectId`:
 *   - single-project scope (id !== null) → flat CreateMenuSplitButton +
 *     PlainClaudeButton (unchanged behavior).
 *   - All-Projects (null) → ProjectCreateMenu cascade + ProjectPlainPicker.
 *
 * Only the *which-surface-renders* branching is unit-tested here; the cascade
 * open/click flow is a Playwright concern.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

import { CreateControls } from "./CreateControls";
import { UNASSIGNED_PROJECT_ID } from "../../lib/projectIds";
import type { ActionDefinition } from "../../lib/externalApi";
import type { Project } from "../../types";

const ACTIONS: ActionDefinition[] = [
  { id: "new-task", label: "New task", kind: "external_launch", command_template: "x" },
  { id: "new-plain", label: "Plain Claude", kind: "external_launch", command_template: "p" },
];

const PROJECTS: Project[] = [
  {
    id: "p1",
    name: "Webui",
    path: "/p1",
    profile: "x",
    status: "active",
    lastActive: "2026-06-01",
    createdAt: "2026-01-01",
  },
  {
    id: "p2",
    name: "Content",
    path: "/p2",
    profile: "x",
    status: "active",
    lastActive: "2026-05-01",
    createdAt: "2026-01-01",
  },
];

const base = {
  realProjects: PROJECTS,
  actionsList: ACTIONS,
  actionsLoading: false,
  previewEnabled: false,
  previewReadyTimeoutSeconds: null,
  resolvedProjectId: "p1",
  onSelect: vi.fn(),
};

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>{ui}</QueryClientProvider>
    </MemoryRouter>,
  );
}

afterEach(() => cleanup());

describe("CreateControls", () => {
  it("single-project mode renders the flat split-button + plain button, no cascade", () => {
    wrap(<CreateControls {...base} activeProjectId="p1" />);
    expect(screen.getByTestId("create-menu-split-button")).toBeTruthy();
    expect(screen.getByTestId("plain-claude-button")).toBeTruthy();
    expect(screen.queryByTestId("create-menu-cascade-trigger")).toBeNull();
    expect(screen.queryByTestId("plain-cascade-trigger")).toBeNull();
  });

  it("All-Projects mode renders the cascade + plain picker, no flat split-button", () => {
    wrap(<CreateControls {...base} activeProjectId={null} />);
    expect(screen.getByTestId("create-menu-cascade-trigger")).toBeTruthy();
    expect(screen.getByTestId("plain-cascade-trigger")).toBeTruthy();
    expect(screen.queryByTestId("create-menu-split-button")).toBeNull();
    expect(screen.queryByTestId("plain-claude-button")).toBeNull();
  });

  // iterate-2026-08-09-triage-filter-styling AC4 — Preview spawns a dev
  // server for ONE project; it has no meaning in All-Projects cascade mode,
  // where resolvedProjectId is just a fallback for the actions dropdown,
  // not a genuine selection.
  it("single-project mode shows Preview when the capability is enabled", () => {
    wrap(<CreateControls {...base} activeProjectId="p1" previewEnabled />);
    expect(screen.getByTestId("preview-button")).toBeTruthy();
  });

  it("All-Projects mode never shows Preview, even when the capability is enabled", () => {
    wrap(<CreateControls {...base} activeProjectId={null} previewEnabled />);
    expect(screen.queryByTestId("preview-button")).toBeNull();
  });

  // code-reviewer Stage 2 finding: TaskBoardPage's resolvedProjectId falls
  // back to realProjects[0] for the synthesized "Unassigned" pseudo-project
  // too (not just null) — a user viewing Unassigned tasks must not see
  // Preview pointed at some other, arbitrary project.
  it("Unassigned pseudo-project never shows Preview, even when the capability is enabled", () => {
    wrap(
      <CreateControls
        {...base}
        activeProjectId={UNASSIGNED_PROJECT_ID}
        resolvedProjectId="p1"
        previewEnabled
      />,
    );
    expect(screen.queryByTestId("preview-button")).toBeNull();
    // The rest of the flat-mode cluster still renders normally — only
    // Preview is scope-gated.
    expect(screen.getByTestId("create-menu-split-button")).toBeTruthy();
    expect(screen.getByTestId("plain-claude-button")).toBeTruthy();
  });
});
