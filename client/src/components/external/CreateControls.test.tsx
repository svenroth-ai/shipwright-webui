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
});
