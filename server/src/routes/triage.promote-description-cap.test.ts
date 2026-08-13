/*
 * triage.promote-description-cap.test.ts —
 * iterate-2026-08-13-task-description-length-cap.
 *
 * A triage `detail` has no producer-side length bound (the github_triage
 * producer self-caps at 1,024 chars; every other producer does not — see
 * shared/scripts/github_triage/{producer,mappers}.py in the sibling
 * monorepo). The promoted task's description is later embedded verbatim
 * as a single-line positional argument in the launch command
 * (`{task.initial_prompt}` / `core/actions-substitute.ts`); past
 * DESCRIPTION_MAX_LENGTH the resulting line risks exceeding the Windows
 * interactive console's line-length ceiling and Claude silently fails to
 * start. Promote must REJECT an over-length detail — not silently
 * truncate it into a quietly-broken task (the prior behavior).
 */
import { writeFileSync } from "node:fs";
import { beforeEach, afterEach, describe, expect, it } from "vitest";

import { appendLine, makeHarness, TRIAGE_HEADER, type Harness } from "./_triage-api-harness.js";
import { _clearCache_TEST_ONLY } from "../core/triage-store.js";
import { DESCRIPTION_MAX_LENGTH } from "../external/_shared/helpers.js";

function seedWithDetail(h: Harness, id: string, detail: string): void {
  writeFileSync(h.triagePath, `${TRIAGE_HEADER}\n${appendLine(id, "drift", detail)}\n`);
  _clearCache_TEST_ONLY();
}

function promoteBody(triageId: string) {
  return { triageId, priority: "P1", domain: "engineering", tags: [] };
}

describe("POST /api/triage/:projectId/promote — description length cap", () => {
  let h: Harness;

  beforeEach(async () => {
    h = await makeHarness();
  });

  afterEach(() => h.cleanup());

  it("rejects an over-cap detail with 400 invalid_description, creating no task and calling no CLI", async () => {
    let cliCalled = false;
    h.cleanup();
    h = await makeHarness({
      runTriageCli: async (input) => {
        cliCalled = true;
        return { kind: "ok", operation: input.operation, item: { id: input.itemId, status: "promoted" } };
      },
    });
    seedWithDetail(h, "trg-decaf001", "x".repeat(DESCRIPTION_MAX_LENGTH + 1));

    const response = await h.app.request("/api/triage/proj-a/promote", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(promoteBody("trg-decaf001")),
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toMatchObject({
      error: "invalid_description",
      detail: `description exceeds ${DESCRIPTION_MAX_LENGTH} characters`,
    });
    expect(h.store.list()).toHaveLength(0);
    expect(cliCalled).toBe(false);
  });

  it("promotes a detail exactly at the cap, carrying it verbatim into the task description", async () => {
    h.cleanup();
    h = await makeHarness({
      runTriageCli: async (input) => ({
        kind: "ok",
        operation: input.operation,
        item: { id: input.itemId, status: "promoted", promotedTaskId: "placeholder" },
      }),
    });
    const detail = "x".repeat(DESCRIPTION_MAX_LENGTH);
    seedWithDetail(h, "trg-decaf002", detail);

    const response = await h.app.request("/api/triage/proj-a/promote", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(promoteBody("trg-decaf002")),
    });

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(h.store.get(body.task.taskId)!.description).toBe(detail);
  });

  it("rejects a detail whose RAW length exceeds the cap even though its TRIMMED length does not (create/edit parity)", async () => {
    let cliCalled = false;
    h.cleanup();
    h = await makeHarness({
      runTriageCli: async (input) => {
        cliCalled = true;
        return { kind: "ok", operation: input.operation, item: { id: input.itemId, status: "promoted" } };
      },
    });
    // Raw length is cap+50 (whitespace padding); trimmed length is exactly
    // the cap. normalizeDescription() (shared with create/edit) caps the
    // RAW string before trimming, so this must reject — a hand-rolled
    // post-trim check would wrongly accept it.
    const padded = " ".repeat(25) + "x".repeat(DESCRIPTION_MAX_LENGTH) + " ".repeat(25);
    seedWithDetail(h, "trg-decaf003", padded);

    const response = await h.app.request("/api/triage/proj-a/promote", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(promoteBody("trg-decaf003")),
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toMatchObject({
      error: "invalid_description",
      detail: `description exceeds ${DESCRIPTION_MAX_LENGTH} characters`,
    });
    expect(h.store.list()).toHaveLength(0);
    expect(cliCalled).toBe(false);
  });
});
