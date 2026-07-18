/*
 * pointer.test.ts — the iterate-pointer trust boundary (CONTRACT §5.1 a/b/e).
 *
 * The pointer is UNTRUSTED input written by an out-of-process producer. These
 * cases are the reason the resolver validates at all: a stale pointer, a
 * pointer naming another project's root, and a pointer whose run_id would
 * traverse out of the planning directory.
 *
 * @covers FR-01.66
 */

import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { isSafeRunId, isSafeSlug, readIteratePointer } from "./pointer.js";

const UUID = "3c9e3e11-4b53-424e-8062-f9f5a24f6b68";

function makeProject(): string {
  const root = mkdtempSync(join(tmpdir(), "mc-pointer-"));
  mkdirSync(join(root, ".shipwright", "iterate_active"), { recursive: true });
  return root;
}

function writePointer(root: string, uuid: string, body: unknown): void {
  writeFileSync(
    join(root, ".shipwright", "iterate_active", `${uuid}.json`),
    typeof body === "string" ? body : JSON.stringify(body),
    "utf-8",
  );
}

function validPointer(root: string, over: Record<string, unknown> = {}) {
  return {
    run_id: "iterate-2026-07-18-demo",
    slug: "demo",
    branch: "iterate/demo",
    worktree_path: join(root, ".worktrees", "demo"),
    main_root: root,
    session_id: UUID,
    created_at: "2026-07-18T10:00:00Z",
    ...over,
  };
}

describe("run_id / slug grammar", () => {
  it("accepts the real producer shape", () => {
    expect(isSafeRunId("iterate-2026-07-18-mission-s1-resolver-core-artifacts")).toBe(true);
    expect(isSafeSlug("terminal-theme-modes")).toBe(true);
  });

  it("rejects every separator and traversal form", () => {
    for (const bad of [
      "..",
      ".",
      "../etc",
      "iterate-../../secret",
      "iterate-a/b",
      "iterate-a\\b",
      "iterate-a%2fb",
      "C:/abs",
      "iterate-a\0b",
      "",
      "-leading-dash-is-fine-but-dot-is-not..",
    ]) {
      expect(isSafeRunId(bad), `run_id ${JSON.stringify(bad)} must be rejected`).toBe(false);
    }
  });

  it("rejects an over-long id (bounded input)", () => {
    expect(isSafeRunId("i" + "x".repeat(200))).toBe(false);
  });

  it("rejects unusual-Unicode ids (homoglyph / RTL-override smuggling)", () => {
    expect(isSafeRunId("iterate-2026‮-demo")).toBe(false);
    expect(isSafeRunId("iterate-аbc")).toBe(false); // Cyrillic a
  });
});

describe("readIteratePointer", () => {
  it("returns a validated pointer for the happy path", () => {
    const root = makeProject();
    try {
      writePointer(root, UUID, validPointer(root));
      const r = readIteratePointer(root, UUID);
      expect(r.status).toBe("ok");
      if (r.status !== "ok") return;
      expect(r.pointer.runId).toBe("iterate-2026-07-18-demo");
      expect(r.pointer.slug).toBe("demo");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("reports `absent` (not an error) when no pointer exists", () => {
    const root = makeProject();
    try {
      expect(readIteratePointer(root, UUID).status).toBe("absent");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("REJECTS a pointer whose session_id is not the requested uuid (§5.1a)", () => {
    const root = makeProject();
    try {
      writePointer(root, UUID, validPointer(root, { session_id: "00000000-0000-0000-0000-000000000000" }));
      const r = readIteratePointer(root, UUID);
      expect(r.status).toBe("invalid");
      if (r.status === "invalid") expect(r.reason).toBe("session_mismatch");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("REJECTS a pointer whose main_root is a different project (§5.1b)", () => {
    const root = makeProject();
    const other = makeProject();
    try {
      writePointer(root, UUID, validPointer(root, { main_root: other }));
      const r = readIteratePointer(root, UUID);
      expect(r.status).toBe("invalid");
      if (r.status === "invalid") expect(r.reason).toBe("main_root_mismatch");
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(other, { recursive: true, force: true });
    }
  });

  it("REJECTS a traversal run_id before it can ever reach a path join", () => {
    const root = makeProject();
    try {
      writePointer(root, UUID, validPointer(root, { run_id: "../../../../etc/passwd" }));
      const r = readIteratePointer(root, UUID);
      expect(r.status).toBe("invalid");
      if (r.status === "invalid") expect(r.reason).toBe("bad_run_id");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not read a pointer for a non-uuid session id (filename grammar)", () => {
    const root = makeProject();
    try {
      const r = readIteratePointer(root, "../../etc/passwd");
      expect(r.status).toBe("invalid");
      if (r.status === "invalid") expect(r.reason).toBe("bad_session_uuid");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("treats malformed JSON as invalid, never as absent (data-integrity honesty)", () => {
    const root = makeProject();
    try {
      writePointer(root, UUID, "{not json");
      const r = readIteratePointer(root, UUID);
      expect(r.status).toBe("invalid");
      if (r.status === "invalid") expect(r.reason).toBe("malformed");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("tolerates unknown extra keys (forward-compat with the producer)", () => {
    const root = makeProject();
    try {
      writePointer(
        root,
        UUID,
        validPointer(root, {
          worktree_relocated_from: join(root, ".worktrees", "demo"),
          worktree_relocated_reason: "scanner prunes .worktrees",
          some_future_key: { nested: true },
        }),
      );
      const r = readIteratePointer(root, UUID);
      expect(r.status).toBe("ok");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("accepts a main_root that differs only by separator style / case on win32", () => {
    const root = makeProject();
    try {
      const shouted = process.platform === "win32" ? root.toUpperCase() : root;
      writePointer(root, UUID, validPointer(root, { main_root: shouted.replace(/\\/g, "/") }));
      expect(readIteratePointer(root, UUID).status).toBe("ok");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
