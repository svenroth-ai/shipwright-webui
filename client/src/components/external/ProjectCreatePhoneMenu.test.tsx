/*
 * ProjectCreatePhoneMenu — phone "+ New" flat drill-down
 * (iterate-2026-06-15 phone-header-polish #1).
 *
 * Verifies the drill-down state machine that replaces the off-screen side
 * submenu on phones: open → project list → tap project (REPLACES content with
 * its actions, menu stays open) → back → tap action → onSelect(action,
 * projectId). Per-project actions resolve from the seeded React Query cache
 * (no fetch), mirroring ProjectCreateCascade.test.tsx.
 */

import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { ProjectCreatePhoneMenu } from "./ProjectCreatePhoneMenu";
import type { ActionDefinition, ResolvedProjectActions } from "../../lib/externalApi";
import type { Project } from "../../types";

beforeAll(() => {
  const proto = Element.prototype as unknown as Record<string, unknown>;
  if (!proto.hasPointerCapture) proto.hasPointerCapture = () => false;
  if (!proto.setPointerCapture) proto.setPointerCapture = () => {};
  if (!proto.releasePointerCapture) proto.releasePointerCapture = () => {};
  if (!proto.scrollIntoView) proto.scrollIntoView = () => {};
});
afterEach(() => cleanup());

const TASK: ActionDefinition = { id: "new-task", label: "New task", kind: "external_launch", command_template: "x" };
const ITERATE: ActionDefinition = { id: "new-iterate", label: "New iterate", kind: "external_launch", command_template: "z" };
const PLAIN: ActionDefinition = { id: "new-plain", label: "Plain Claude", kind: "external_launch", command_template: "p" };

function resolved(actions: ActionDefinition[]): ResolvedProjectActions {
  return {
    actions, phases: [], defaults: { autonomy: "guided" },
    preview: { enabled: false, command: null, port: null, ready_path: null, ready_timeout_seconds: null },
    diagnostics: [],
  };
}
const PROJECTS: Project[] = [
  { id: "p1", name: "Webui", path: "/p1", profile: "x", status: "active", lastActive: "2026-06-01", createdAt: "2026-01-01" },
  { id: "p2", name: "Content", path: "/p2", profile: "x", status: "active", lastActive: "2026-05-01", createdAt: "2026-01-01" },
];

function renderMenu(projects: Project[], onSelect = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(["project-actions", "p1"], resolved([TASK, ITERATE, PLAIN]));
  vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
  render(
    <QueryClientProvider client={qc}>
      <ProjectCreatePhoneMenu projects={projects} onSelect={onSelect} />
    </QueryClientProvider>,
  );
  return { onSelect };
}

describe("ProjectCreatePhoneMenu (phone #1)", () => {
  it("trigger is disabled when there are no projects", () => {
    renderMenu([]);
    expect((screen.getByTestId("create-menu-cascade-trigger") as HTMLButtonElement).disabled).toBe(true);
  });

  it("drills project → actions in the SAME downward popup (no side submenu), then back", async () => {
    const user = userEvent.setup();
    renderMenu(PROJECTS);
    await user.click(screen.getByTestId("create-menu-cascade-trigger"));
    const content = await screen.findByTestId("create-menu-cascade-content");
    // Level 1: projects.
    expect(within(content).getByTestId("create-menu-cascade-project-p1")).toBeTruthy();
    // Drill into p1 — content REPLACES with p1's actions, menu stays open.
    await user.click(screen.getByTestId("create-menu-cascade-project-p1"));
    expect(await screen.findByTestId("create-menu-cascade-action-p1-new-task")).toBeTruthy();
    expect(screen.getByTestId("create-menu-cascade-action-p1-new-iterate")).toBeTruthy();
    // new-plain is filtered out of the create list.
    expect(screen.queryByTestId("create-menu-cascade-action-p1-new-plain")).toBeNull();
    // Project list is gone (replaced, not a side submenu).
    expect(screen.queryByTestId("create-menu-cascade-project-p2")).toBeNull();
    // Back returns to the project list.
    await user.click(screen.getByTestId("create-menu-phone-back"));
    expect(await screen.findByTestId("create-menu-cascade-project-p2")).toBeTruthy();
  });

  it("selecting an action calls onSelect(action, projectId)", async () => {
    const user = userEvent.setup();
    const { onSelect } = renderMenu(PROJECTS);
    await user.click(screen.getByTestId("create-menu-cascade-trigger"));
    await user.click(await screen.findByTestId("create-menu-cascade-project-p1"));
    await user.click(await screen.findByTestId("create-menu-cascade-action-p1-new-task"));
    expect(onSelect).toHaveBeenCalledWith(TASK, "p1");
  });
});
