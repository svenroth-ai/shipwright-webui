/*
 * Drift-guard: the frozen-field tuple that drives the Edit Task dialog is
 * mirrored across the two independent npm workspaces (CLAUDE.md DO-NOT
 * guard #7 — server and client never import each other).
 * `FROZEN_WHEN_STARTED` lives in BOTH `server/src/core/task-editability.ts`
 * and `client/src/lib/taskEditability.ts`; if they drift, the modal would
 * grey out a different set of fields than the PATCH route rejects.
 * iterate-2026-05-18-edit-task-dialog.
 *
 * Sibling of `backlog-states-mirror.test.ts`. Reads the client file as
 * TEXT — not an import — so it does not itself violate the cross-package
 * rule. Also exercises the server `isNeverStarted` / `isFieldEditable`
 * behavior directly (a real import — same workspace).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  FROZEN_WHEN_STARTED,
  isNeverStarted,
  isFieldEditable,
} from "../core/task-editability";

const __dirname = dirname(fileURLToPath(import.meta.url));
// server/src/test/ → server/src → repo root
const SERVER_SRC = resolve(__dirname, "..");
const REPO_ROOT = resolve(SERVER_SRC, "../..");

/** Extract the quoted string members of a `const NAME = [ ... ]` literal. */
function extractTuple(source: string, constName: string): string[] {
  const m = new RegExp(`${constName}\\s*=\\s*\\[([\\s\\S]*?)\\]`).exec(source);
  if (!m) throw new Error(`could not find ${constName} array literal`);
  return [...m[1].matchAll(/["']([^"']+)["']/g)].map((x) => x[1]);
}

describe("FROZEN_WHEN_STARTED — server/client mirror parity", () => {
  it("server and client tuples are byte-identical", () => {
    const serverSrc = readFileSync(
      resolve(SERVER_SRC, "core/task-editability.ts"),
      "utf8",
    );
    const clientSrc = readFileSync(
      resolve(REPO_ROOT, "client/src/lib/taskEditability.ts"),
      "utf8",
    );
    const server = extractTuple(serverSrc, "FROZEN_WHEN_STARTED");
    const client = extractTuple(clientSrc, "FROZEN_WHEN_STARTED");
    // Order matters too — assert the exact sequence, not just the set.
    expect(client).toEqual(server);
  });

  it("the frozen set is exactly the four launch-shaping fields", () => {
    // Review finding #12 — pin the exact membership, not just parity.
    expect([...FROZEN_WHEN_STARTED]).toEqual([
      "description",
      "phase",
      "priority",
      "complexityHint",
    ]);
  });
});

describe("isNeverStarted", () => {
  it("true for a fresh draft with no launchedAt / firstJsonlObservedAt", () => {
    expect(isNeverStarted({ state: "draft" })).toBe(true);
  });

  it("false for a draft that has a launchedAt (backlogged after running)", () => {
    expect(
      isNeverStarted({ state: "draft", launchedAt: "2026-05-18T00:00:00Z" }),
    ).toBe(false);
  });

  it("false for a draft that has a firstJsonlObservedAt", () => {
    expect(
      isNeverStarted({
        state: "draft",
        firstJsonlObservedAt: "2026-05-18T00:00:00Z",
      }),
    ).toBe(false);
  });

  it("false for any non-draft state", () => {
    for (const state of ["active", "idle", "done", "launch_failed"] as const) {
      expect(isNeverStarted({ state })).toBe(false);
    }
  });
});

describe("isFieldEditable", () => {
  it("never-started: every field editable", () => {
    const task = { state: "draft" as const };
    for (const f of [
      "title",
      "description",
      "phase",
      "priority",
      "complexityHint",
      "domain",
      "tags",
      "blockedBy",
    ]) {
      expect(isFieldEditable(f, task)).toBe(true);
    }
  });

  it("started: launch-shaping fields frozen, metadata editable", () => {
    const task = { state: "active" as const };
    expect(isFieldEditable("description", task)).toBe(false);
    expect(isFieldEditable("phase", task)).toBe(false);
    expect(isFieldEditable("priority", task)).toBe(false);
    expect(isFieldEditable("complexityHint", task)).toBe(false);
    expect(isFieldEditable("title", task)).toBe(true);
    expect(isFieldEditable("projectId", task)).toBe(true);
    expect(isFieldEditable("domain", task)).toBe(true);
    expect(isFieldEditable("tags", task)).toBe(true);
    expect(isFieldEditable("blockedBy", task)).toBe(true);
  });
});
