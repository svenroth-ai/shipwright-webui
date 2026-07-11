/*
 * Spec 62 — v1 → v4 schema migration on write-on-touch (ADR-038). D05 / F20.
 *
 * REPAIRED (F20): the prior spec computed a WRONG registry path
 * (`~/.shipwright/webui`) and honored a dead `WEBUI_REGISTRY_DIR` env var no
 * server reads, so `storeExists` was always false and the v1 seed + on-disk
 * assertions were DEAD CODE (a green smoke). It also asserted schemaVersion
 * === 2 while the store persists 4. A naive path fix would have downgraded
 * the user's REAL store.
 *
 * This version runs ONLY against an isolated temp-USERPROFILE stack and
 * hard-aborts (Guard 1 self-lock) if the resolved registry dir is not under
 * os.tmpdir(), so the real ~/.shipwright-webui can never be mutated.
 *
 * Flow:
 *   1. Seed two pure v1 rows (schemaVersion 1, NO projectId) to the isolated
 *      store — NOT yet in server memory.
 *   2. POST a probe task: this triggers store.persist(), which re-reads the
 *      seeded file under the lock and merges the v1 rows into memory via the
 *      v1 load path — backfilling projectId="unassigned" — AND upgrades the
 *      on-disk file to schemaVersion 4 (write-on-touch).
 *   3. Assert the two legacy rows load classified as Unassigned (API + the
 *      board's Unassigned project filter renders the legacy card).
 *   4. PATCH a legacy row (write-on-touch on the migrated row) and assert the
 *      on-disk file stays v4 with a projectId on EVERY row.
 *
 * RED-first (Guard 3): break the v1 load path (drop the schemaVersion===1
 * projectId backfill so v1 rows soft-skip validation) and the seeded rows
 * never surface — step 3 fails. Green on main.
 */

import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import os from "node:os";

import {
  EXPECTED_SCHEMA_VERSION,
  UNASSIGNED_PROJECT_ID,
  assertIsolatedStore,
  isolatedStorePath,
  readIsolatedStore,
  seedV1Store,
} from "../helpers/isolated-store";

interface ApiTask {
  taskId: string;
  projectId: string;
}

test.describe("Schema v1 → v4 migration (ADR-038)", () => {
  test("legacy v1 rows load as Unassigned + disk upgrades to v4 on write-on-touch", async ({
    page,
    request,
  }) => {
    // Guard 1 — hard-abort before ANY write unless the store is isolated.
    const storePath = assertIsolatedStore(isolatedStorePath());

    // 1. Seed two pure v1 rows (schemaVersion 1, no projectId) with known ids.
    const rowA = randomUUID();
    const rowB = randomUUID();
    const titleA = `v1-seed-a-${Date.now()}`;
    const titleB = `v1-seed-b-${Date.now()}`;
    seedV1Store(
      [
        { taskId: rowA, title: titleA },
        { taskId: rowB, title: titleB },
      ],
      storePath,
    );

    // 2. Force the server to observe the seed: a create triggers persist(),
    //    which re-reads + merges the v1 rows (backfilling "unassigned") and
    //    rewrites the file as v4.
    const probeResp = await request.post("/api/external/tasks", {
      data: { title: `v1-probe-${Date.now()}`, cwd: os.tmpdir() },
    });
    expect(probeResp.status(), await probeResp.text()).toBe(200);
    const { task: probe } = (await probeResp.json()) as { task: { taskId: string } };

    try {
      // 3. The two legacy rows are now live + classified Unassigned.
      const listResp = await request.get("/api/external/tasks");
      expect(listResp.ok()).toBeTruthy();
      const { tasks } = (await listResp.json()) as { tasks: ApiTask[] };
      const seededA = tasks.find((t) => t.taskId === rowA);
      const seededB = tasks.find((t) => t.taskId === rowB);
      expect(seededA, "v1 row A must survive the load path (not dropped)").toBeTruthy();
      expect(seededB, "v1 row B must survive the load path (not dropped)").toBeTruthy();
      expect(seededA?.projectId).toBe(UNASSIGNED_PROJECT_ID);
      expect(seededB?.projectId).toBe(UNASSIGNED_PROJECT_ID);

      // UI: under the Unassigned project filter BOTH legacy cards render, so
      // a UI that surfaces only one migrated legacy row fails.
      await page.goto(`/?projectId=${UNASSIGNED_PROJECT_ID}`);
      await expect(page.getByTestId("task-board-page")).toBeVisible();
      await expect(page.getByTestId(`task-card-${rowA}`)).toBeVisible({
        timeout: 8000,
      });
      await expect(page.getByTestId(`task-card-${rowB}`)).toBeVisible({
        timeout: 8000,
      });

      // 4. Write-on-touch PATCH on the legacy row itself.
      const patchResp = await request.patch(`/api/external/tasks/${rowA}`, {
        data: { title: `${titleA}-migrated` },
      });
      expect(
        patchResp.ok(),
        `PATCH must succeed — got ${patchResp.status()}`,
      ).toBeTruthy();

      // On disk: upgraded to v4, EVERY row now carries a projectId.
      const after = readIsolatedStore(storePath);
      expect(after, "store must exist on disk after the touch").toBeTruthy();
      expect(after?.schemaVersion).toBe(EXPECTED_SCHEMA_VERSION);
      for (const [tid, row] of Object.entries(after?.sessions ?? {})) {
        expect(typeof row.projectId, `row ${tid} must carry a projectId on disk`).toBe(
          "string",
        );
        expect(
          (row.projectId ?? "").length,
          `row ${tid} projectId must be non-empty`,
        ).toBeGreaterThan(0);
      }
      // The seeded legacy rows specifically resolved to the Unassigned sentinel.
      expect(after?.sessions[rowA]?.projectId).toBe(UNASSIGNED_PROJECT_ID);
      expect(after?.sessions[rowB]?.projectId).toBe(UNASSIGNED_PROJECT_ID);
      expect(after?.sessions[rowA]?.title).toBe(`${titleA}-migrated`);
    } finally {
      // Cleanup — remove the three rows this spec created.
      for (const id of [rowA, rowB, probe.taskId]) {
        await request.delete(`/api/external/tasks/${id}`).catch(() => {});
      }
    }
  });
});
