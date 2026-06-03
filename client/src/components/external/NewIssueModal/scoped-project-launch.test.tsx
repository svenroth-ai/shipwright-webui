/*
 * AC2 contract guard (iterate-2026-06-02-all-projects-create-cascade).
 *
 * The All-Projects cascade fixes the latent mismatch bug by always opening the
 * modal scoped to ONE project: it passes `initialProjectId` = the cascade-chosen
 * project AND `projectActions` resolved for that same project. This test pins
 * the modal half of that contract: when `initialProjectId` names a project that
 * is NOT the first/active one, the create payload's `projectId` + `cwd` follow
 * `initialProjectId` (not the list head). If this regresses, the cascade would
 * launch against the wrong project — exactly consequence #3 in the spec.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { screen, fireEvent, act, cleanup, waitFor } from "@testing-library/react";

import { makeFetchMock, renderModal } from "./__testFixtures";

const TWO_PROJECTS = [
  {
    id: "proj-1",
    name: "demo",
    path: "/tmp/demo",
    profile: "x",
    status: "active",
    createdAt: "2026-04-01",
    lastActive: "2026-04-20",
  },
  {
    id: "proj-2",
    name: "content",
    path: "/tmp/content",
    profile: "x",
    status: "active",
    createdAt: "2026-04-01",
    lastActive: "2026-04-10",
  },
];

beforeEach(() => {
  if (typeof window !== "undefined" && window.sessionStorage)
    window.sessionStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("modal scopes create payload to initialProjectId (AC2)", () => {
  it("launches against the cascade-chosen project, not the list head", async () => {
    const cap: { body?: string } = {};
    globalThis.fetch = makeFetchMock({
      captureCreate: cap,
    }) as unknown as typeof fetch;

    renderModal({
      projectsOverride: TWO_PROJECTS,
      initialProjectId: "proj-2",
      onToast: () => {},
    });

    await act(async () => {
      fireEvent.change(screen.getByTestId("new-issue-title-input"), {
        target: { value: "scoped task" },
      });
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("new-issue-save-btn"));
    });
    await waitFor(() => expect(cap.body).toBeTruthy());

    const parsed = JSON.parse(cap.body!);
    expect(parsed.projectId).toBe("proj-2");
    expect(parsed.cwd).toBe("/tmp/content");
  });
});
