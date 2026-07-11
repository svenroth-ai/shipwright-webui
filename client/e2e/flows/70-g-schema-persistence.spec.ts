/*
 * Flow G — Schema v4 persistence on PATCH (ADR-038). D05 / F19.
 *
 * REPAIRED (F19): the prior spec hard-asserted on-disk schemaVersion === 2,
 * but the store has persisted CURRENT_SCHEMA_VERSION = 4 since
 * iterate-2026-06-17 — so it was permanently red (or skipped). It also read
 * the REAL store, used an absolute http://localhost:3847 (bypassing baseURL),
 * and a hardcoded UAT projectId, so it could not run isolated.
 *
 * This version runs ONLY against an isolated temp-USERPROFILE stack and
 * hard-aborts (Guard 1 self-lock) if the resolved registry dir is not under
 * os.tmpdir(), so the real ~/.shipwright-webui can never be mutated. It uses
 * the relative baseURL (no absolute :3847), no hardcoded UAT projectId, and
 * asserts against EXPECTED_SCHEMA_VERSION (mirrored from the server) rather
 * than a stale literal.
 *
 * Contract:
 *   1. A rename PATCH succeeds (no 500).
 *   2. After the rename the on-disk file is STILL schemaVersion 4 (no
 *      accidental downgrade), the renamed task carries a projectId, a
 *      pre-existing bystander row keeps its projectId, and the task count
 *      grew by exactly the one created-then-renamed task.
 */

import { test, expect } from "@playwright/test";
import os from "node:os";
import type { APIRequestContext } from "@playwright/test";

import {
  EXPECTED_SCHEMA_VERSION,
  assertIsolatedStore,
  isolatedStorePath,
  readIsolatedStore,
} from "../helpers/isolated-store";

async function createTask(
  request: APIRequestContext,
  title: string,
): Promise<string> {
  const res = await request.post("/api/external/tasks", {
    data: { title, cwd: os.tmpdir() },
  });
  if (!res.ok()) {
    throw new Error(`create task: HTTP ${res.status()} — ${await res.text()}`);
  }
  const body = (await res.json()) as { task: { taskId: string } };
  return body.task.taskId;
}

test.describe("Flow G — Schema v4 persistence (ADR-038)", () => {
  test("rename PATCH keeps schemaVersion 4 + preserves every row's projectId", async ({
    request,
  }) => {
    // Guard 1 — hard-abort before ANY write unless the store is isolated.
    const storePath = assertIsolatedStore(isolatedStorePath());

    // Bystander row — proves OTHER rows keep their projectId across the PATCH.
    const bystander = await createTask(request, `spec70g-bystander-${Date.now()}`);
    try {
      // Snapshot BEFORE the rename target is created.
      const before = readIsolatedStore(storePath);
      expect(before, "store must exist after a create").toBeTruthy();
      expect(
        before?.schemaVersion,
        "store must persist the current schema version",
      ).toBe(EXPECTED_SCHEMA_VERSION);
      const countBefore = Object.keys(before?.sessions ?? {}).length;
      const bystanderProjectBefore = before?.sessions[bystander]?.projectId;
      expect(typeof bystanderProjectBefore).toBe("string");

      // Create the throw-away task to rename.
      const target = await createTask(request, `spec70g-schema-${Date.now()}`);
      try {
        const newTitle = `spec70g-renamed-${Date.now()}`;
        const patchResp = await request.patch(`/api/external/tasks/${target}`, {
          data: { title: newTitle },
        });
        expect(
          patchResp.ok(),
          `PATCH must succeed — got ${patchResp.status()}`,
        ).toBeTruthy();

        // Re-read disk.
        const after = readIsolatedStore(storePath);
        expect(after, "store must exist after PATCH").toBeTruthy();
        // No accidental downgrade.
        expect(
          after?.schemaVersion,
          "schemaVersion must remain v4 after PATCH",
        ).toBe(EXPECTED_SCHEMA_VERSION);

        const persisted = after?.sessions[target];
        expect(persisted, "renamed task must be in the on-disk store").toBeTruthy();
        expect(persisted?.title).toBe(newTitle);
        expect(typeof persisted?.projectId).toBe("string");
        expect((persisted?.projectId ?? "").length).toBeGreaterThan(0);

        // Count grew by exactly the created-then-renamed task.
        expect(Object.keys(after?.sessions ?? {}).length).toBe(countBefore + 1);

        // The bystander kept its projectId (no schema regression dropped it).
        expect(after?.sessions[bystander]?.projectId).toBe(bystanderProjectBefore);

        // No row lost its projectId field — HARD assertion: the ADR-038
        // downgrade-guard's whole point is that a regression dropping
        // projectId from ANY persisted row must turn this spec red.
        for (const [tid, row] of Object.entries(after?.sessions ?? {})) {
          expect(
            typeof row.projectId,
            `task ${tid} must still carry a projectId field`,
          ).toBe("string");
        }
      } finally {
        await request.delete(`/api/external/tasks/${target}`).catch(() => {});
      }
    } finally {
      await request.delete(`/api/external/tasks/${bystander}`).catch(() => {});
    }
  });
});
