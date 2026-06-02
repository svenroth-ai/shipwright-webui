/*
 * Spec 90 — All-Projects create-menu cascade
 * (iterate-2026-06-02-all-projects-create-cascade).
 *
 * In "All Projects" mode the `+ New` control becomes a project-first cascade
 * (and Plain Claude a project picker), so the action set is always resolved
 * for ONE concrete project and the modal opens scoped to it. Covers:
 *   AC1 — project level renders; expanding a project shows its actions.
 *   AC2 — selecting an action opens the modal scoped to THAT project
 *         (project select pre-filled), not the list head.
 *   AC3 — single-project mode is NOT the cascade (flat split-button instead).
 *   AC5 — Plain Claude picker scopes a plain session to the chosen project.
 *   List view shares the same header → the cascade is present there too.
 */

import { test, expect } from "@playwright/test";

test.describe("All-Projects create-menu cascade (iterate-2026-06-02)", () => {
  test("cascade scopes New + Plain to the chosen project, in board and list views", async ({
    page,
    request,
  }) => {
    const suffix = Date.now();
    const mk = (name: string) =>
      request.post("/api/projects", {
        data: { name, path: process.cwd(), profile: "default", status: "active" },
      });
    const { data: a } = (await (await mk(`cascade-a-${suffix}`)).json()) as {
      data: { id: string };
    };
    const { data: b } = (await (await mk(`cascade-b-${suffix}`)).json()) as {
      data: { id: string };
    };

    await page.goto("/");
    await expect(page.getByTestId("task-board-page")).toBeVisible();

    // AC3 — All-Projects (default) shows the cascade, NOT the flat split-button.
    await expect(page.getByTestId("create-menu-cascade-trigger")).toBeVisible();
    await expect(page.getByTestId("create-menu-split-button")).toHaveCount(0);

    // AC1 — open the cascade; both seeded projects appear as first-level rows.
    await page.getByTestId("create-menu-cascade-trigger").click();
    await expect(
      page.getByTestId(`create-menu-cascade-project-${a.id}`),
    ).toBeVisible();
    await expect(
      page.getByTestId(`create-menu-cascade-project-${b.id}`),
    ).toBeVisible();

    // AC1 — expanding project A lazily reveals ITS actions (bundled default).
    // Click (not hover) opens the Radix submenu "sticky" — hover-open closes
    // the moment the pointer leaves the safe-area en route to the action item.
    await page.getByTestId(`create-menu-cascade-project-${a.id}`).click();
    const aTask = page.getByTestId(`create-menu-cascade-action-${a.id}-new-task`);
    await expect(aTask).toBeVisible();

    // AC2 — selecting it opens the modal scoped to project A. Use keyboard
    // Enter (Radix menuitem onSelect) — a pointer click on a portalled submenu
    // item is intercepted by the dismissable-layer hit-test in headless Chrome.
    await aTask.press("Enter");
    const taskModal = page.getByTestId("new-issue-modal-new-task");
    await expect(taskModal).toBeVisible();
    await expect(page.getByTestId("new-issue-project-select")).toHaveValue(a.id);
    // AC6 — selecting from the cascade does NOT mutate the board filter
    // (no hidden scope switch); it stays on "All projects".
    await expect(page.getByTestId("project-filter-dropdown")).toContainText(
      "All projects",
    );
    await page.keyboard.press("Escape");
    await expect(taskModal).toHaveCount(0);

    // AC5 — Plain Claude picker scopes a plain session to project B.
    await page.getByTestId("plain-cascade-trigger").click();
    const plainB = page.getByTestId(`plain-cascade-project-${b.id}`);
    await expect(plainB).toBeVisible();
    await plainB.press("Enter");
    const plainModal = page.getByTestId("new-issue-modal-new-plain");
    await expect(plainModal).toBeVisible();
    await expect(page.getByTestId("new-issue-project-select")).toHaveValue(b.id);
    await page.keyboard.press("Escape");
    await expect(plainModal).toHaveCount(0);

    // Shared header — switching to the List view keeps the cascade (the create
    // cluster lives above the board/list body switch, not inside it).
    await page.getByTestId("view-toggle-list").click();
    await expect(page.getByTestId("create-menu-cascade-trigger")).toBeVisible();

    // AC3 round-trip — scoping to a single project swaps the cascade back for
    // the flat split-button (proves the flat path survives the extraction).
    await page.getByTestId("project-filter-dropdown").click();
    await page.getByTestId(`project-filter-dropdown-item-${a.id}`).click();
    await expect(page.getByTestId("create-menu-split-button")).toBeVisible();
    await expect(page.getByTestId("create-menu-cascade-trigger")).toHaveCount(0);

    // Cleanup so the seeded projects don't leak across runs.
    await request.delete(`/api/projects/${a.id}`);
    await request.delete(`/api/projects/${b.id}`);
  });
});
