/*
 * server/src/external/__tests__/api-contract-sweep.test.ts
 *
 * Bit-perfect API-contract regression guard for the C2 split
 * (campaign-C-C2-external-routes-split, merged 2026-05-26 as PR #71).
 *
 * For every endpoint in `api-contract-baseline.json` — a 22-entry snapshot
 * of the external API surface taken from `routes.ts @ ce08c5d (origin/main)`
 * at the start of the C2 split — the suite exercises one or more deterministic
 * `app.request()` probes through Hono's in-memory router and asserts the
 * EXACT documented status code (not a permissive "in some allowed set" match).
 *
 * Design notes
 * ------------
 * - Hermetic: no port binding, no subprocess, no real `~/.claude/projects`
 *   filesystem dependency. The in-memory deps + tmpdir SessionWatcher pattern
 *   is duplicated locally (not extracted from `routes.test.ts`) to keep the
 *   blast radius of edits to this suite minimal — extract only when a third
 *   consumer materialises.
 *
 * - `PROBE_TABLE` lives in a sibling module so this test file stays under
 *   the 300-LOC project guideline. Multiple PROBE_TABLE entries may share
 *   one `baselineId` (e.g. `tasks.patch` probes both 404 and 400 paths).
 *   The two meta-tests at the bottom of this file pin both directions of
 *   drift: every `baseline.endpoints[].id` MUST have at least one probe,
 *   and every `probe.baselineId` MUST exist in the baseline.
 *
 * - The baseline JSON is intentionally duplicated from
 *   `.shipwright/planning/iterate/campaigns/2026-05-25-bloat-cleanup-C-webui/sub-iterates/_c2_api_baseline.json`.
 *   The planning-dir copy is the historical record tied to the campaign;
 *   the co-located copy here is the live regression anchor. Future
 *   endpoint changes update only the co-located copy.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

import baseline from "./api-contract-baseline.json";
import {
  EXISTENT_PROJECT,
  NONEXISTENT_PROJECT,
  PROBE_TABLE,
} from "./api-contract-probes.js";

import {
  SdkSessionsStore,
  type SdkSessionsStoreDeps,
} from "../../core/sdk-sessions-store.js";
import { SessionWatcher } from "../../core/session-watcher.js";
import { PreviewSessionManager } from "../../core/preview-session-manager.js";
import { createExternalRoutes } from "../routes.js";

function inMemoryDeps(): SdkSessionsStoreDeps {
  const files = new Map<string, string>();
  const existing = new Set<string>();
  return {
    readFile: async (p) => {
      if (!files.has(p)) {
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      }
      return files.get(p)!;
    },
    writeFile: async (p, data) => {
      files.set(p, data);
      existing.add(p);
    },
    existsSync: (p) => existing.has(p),
    mkdirSync: (p) => {
      existing.add(p);
    },
    ensureFile: (p) => {
      if (!files.has(p)) files.set(p, "");
      existing.add(p);
    },
  };
}

describe("api-contract-sweep — C2 baseline (PR #71)", () => {
  let app: Hono;
  let store: SdkSessionsStore;
  let projectsDir: string;

  beforeEach(async () => {
    projectsDir = mkdtempSync(path.join(tmpdir(), "api-contract-sweep-"));
    const deps = inMemoryDeps();
    store = new SdkSessionsStore("/store/sdk-sessions.json", deps);
    await store.load();
    const watcher = new SessionWatcher({ projectsDir });
    app = new Hono();
    app.route(
      "/",
      createExternalRoutes({
        store,
        watcher,
        // Recognise EXISTENT_PROJECT so probes can target post-existence
        // branches (e.g. `projects.file` path_required → 400). NONEXISTENT
        // returns undefined → 404 project_not_found.
        getProjectById: (id) =>
          id === EXISTENT_PROJECT
            ? {
                id: EXISTENT_PROJECT,
                name: "synthetic test project",
                path: projectsDir,
                profile: "vite-hono",
              }
            : undefined,
        // Wire a real PreviewSessionManager so /preview clears the 501
        // `preview_unavailable` gate and reaches the project lookup —
        // otherwise the probe would always short-circuit at line 1.
        // `previewManager.spawn()` is not invoked along the 404 path.
        previewManager: new PreviewSessionManager(),
        ptyManager: { get: () => undefined },
      }),
    );
  });

  afterEach(() => {
    try {
      rmSync(projectsDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it.each(PROBE_TABLE)(
    "$baselineId — $describe",
    async (probe) => {
      const init: RequestInit = { method: probe.method };
      if (probe.body !== undefined) {
        init.body = JSON.stringify(probe.body);
        init.headers = { "Content-Type": "application/json" };
      }

      const res = await app.request(probe.path, init);
      expect(
        res.status,
        `${probe.method} ${probe.path} returned ${res.status}, expected ${probe.expectStatus}`,
      ).toBe(probe.expectStatus);

      const needsJson =
        probe.expectErrorCode || probe.expectStatusField || probe.expectKeys;
      if (needsJson) {
        const contentType = res.headers.get("content-type") ?? "";
        // Hono's framework-default 404 (route not registered) returns
        // text/plain "404 Not Found" — that is precisely the regression
        // we want to catch when a sub-router gets accidentally unmounted.
        // Require JSON when the probe documents body shape; do not
        // silently skip on text/plain.
        expect(
          contentType,
          `${probe.method} ${probe.path} content-type=${contentType} — expected application/json (route may be unmounted or returning framework default)`,
        ).toContain("application/json");
        const body = (await res.json()) as Record<string, unknown>;
        if (probe.expectErrorCode) {
          expect(body.error).toBe(probe.expectErrorCode);
        }
        if (probe.expectStatusField) {
          expect(body.status).toBe(probe.expectStatusField);
        }
        if (probe.expectKeys) {
          for (const k of probe.expectKeys) {
            expect(body).toHaveProperty(k);
          }
        }
      }
    },
  );

  // ---------------------------------------------------------------------
  // Targeted invariants that don't fit the generic PROBE_TABLE shape.
  // ---------------------------------------------------------------------

  /**
   * Defensive seed helper — validates the create response BEFORE
   * destructuring so any regression in `tasks.create` surfaces at the
   * seed call site with a clear status diff instead of a misleading
   * destructuring error in the test that depends on the seed.
   */
  async function seedTask(): Promise<{ taskId: string; sessionUuid: string }> {
    const create = await app.request("/api/external/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "seed", cwd: "/tmp" }),
    });
    expect(
      create.status,
      "seedTask: tasks.create regressed — cannot run seeded probe",
    ).toBe(200);
    const { task } = (await create.json()) as {
      task: { taskId: string; sessionUuid: string };
    };
    expect(task?.taskId, "seedTask: response missing taskId").toBeTruthy();
    expect(task?.sessionUuid, "seedTask: response missing sessionUuid").toBeTruthy();
    return task;
  }

  it("tasks.patch — 400 at_least_one_field_required on existing task + empty body", async () => {
    const task = await seedTask();
    const res = await app.request(`/api/external/tasks/${task.taskId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe("at_least_one_field_required");
  });

  it(
    "tasks.transcript — {status:'missing'} variant on existing task without JSONL " +
      "(documented success-key subset: status + task)",
    async () => {
      const task = await seedTask();
      const res = await app.request(
        `/api/external/tasks/${task.taskId}/transcript?fromByte=0`,
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.status).toBe("missing");
      // Documented key subset for the `missing` variant per baseline.
      for (const k of ["status", "task"]) expect(body).toHaveProperty(k);
    },
  );

  it(
    "transcript multi-tab stateless — parallel fetches with identical " +
      "fromByte+expectFingerprint return bytewise-identical responses " +
      "(CLAUDE.md rule 4 — server holds no per-session byte-offset cache)",
    async () => {
      const task = await seedTask();

      // Identical query params on both legs — the rule is the SERVER
      // holds no per-session state, so two callers with the same
      // (fromByte, expectFingerprint) must always see identical bytes.
      // The synthetic fingerprint is non-matching → server returns
      // {status:"rotated"} OR the missing variant; either way both
      // legs see the same answer.
      const url =
        `/api/external/tasks/${task.taskId}/transcript` +
        `?fromByte=0&expectFingerprint=sha256:synthetic`;
      const [a, b] = await Promise.all([
        app.request(url),
        app.request(url),
      ]);
      expect(a.status).toBe(b.status);

      const [bodyA, bodyB] = await Promise.all([a.text(), b.text()]);
      // Bytewise-identical responses on parallel calls = no per-session
      // state was mutated between them (the C2 split must not have
      // introduced a per-session byte-offset cache).
      expect(bodyA).toBe(bodyB);
    },
  );

  it(
    "run-config no-mutation — POST/PATCH/PUT/DELETE on /projects/:id/run-config " +
      "all return 404 (no handler defined; CLAUDE.md rule 12 — read-only observer)",
    async () => {
      const url = `/api/external/projects/${NONEXISTENT_PROJECT}/run-config`;
      for (const method of ["POST", "PATCH", "PUT", "DELETE"] as const) {
        const res = await app.request(url, { method });
        expect(
          res.status,
          `${method} ${url} returned ${res.status}; rule 12 requires 404 (no handler)`,
        ).toBe(404);
      }
    },
  );

  // ---------------------------------------------------------------------
  // Meta-tests — protect both directions of baseline ↔ probe drift.
  // ---------------------------------------------------------------------

  it("baseline drift — every baseline.endpoints[].id has at least one PROBE_TABLE entry", () => {
    const probedIds = new Set(PROBE_TABLE.map((p) => p.baselineId));
    const missing = (baseline.endpoints as Array<{ id: string }>)
      .map((e) => e.id)
      .filter((id) => !probedIds.has(id));
    expect(missing, "endpoints missing from PROBE_TABLE").toEqual([]);
  });

  it("baseline drift — every PROBE_TABLE.baselineId resolves to a baseline entry", () => {
    const baselineIds = new Set(
      (baseline.endpoints as Array<{ id: string }>).map((e) => e.id),
    );
    const orphans = [...new Set(PROBE_TABLE.map((p) => p.baselineId))].filter(
      (id) => !baselineIds.has(id),
    );
    expect(orphans, "PROBE_TABLE entries with no matching baseline id").toEqual([]);
  });

  it("baseline metadata — endpoint_count matches actual entry count", () => {
    const meta = (baseline as { _meta: { endpoint_count: number } })._meta;
    expect(meta.endpoint_count).toBe(
      (baseline as { endpoints: unknown[] }).endpoints.length,
    );
  });
});
