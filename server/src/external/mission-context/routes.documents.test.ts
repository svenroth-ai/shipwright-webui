/*
 * routes.documents.test.ts — the OPAQUE artifact-detail endpoint (AC3 / AC5).
 *
 * A signed document id is a capability, not a licence: these cases pin that the
 * endpoint re-verifies task / session / project ownership at READ time and
 * re-guards the path, so neither a cross-task id nor a cross-project id nor a
 * mint carrying a traversal `rel` can read a foreign file.
 *
 * @covers FR-01.66
 */

import { beforeEach, describe, expect, it } from "vitest";
import { rmSync } from "node:fs";
import { join } from "node:path";

import { _clearResolverCache } from "../../core/mission-context/resolver.js";
import { mintDocId } from "../../core/mission-context/doc-ids.js";
import {
  artifact,
  getContext,
  harness,
  makeProject,
  makeTask,
  RUN_ID,
  SPEC_REL,
  UUID,
} from "./test-harness.js";

type DocResponse = { status?: string; error?: string; document?: { title: string; body: string } };

async function fetchDoc(
  app: ReturnType<typeof harness>["app"],
  id: string | undefined,
): Promise<{ httpStatus: number; body: DocResponse }> {
  const res = await app.request(`/api/external/tasks/task-1/mission-context/documents/${id}`);
  return { httpStatus: res.status, body: (await res.json()) as DocResponse };
}

async function specDocId(app: ReturnType<typeof harness>["app"]): Promise<string | undefined> {
  const ctx = await getContext(app);
  return artifact(ctx, "spec")?.detail?.documentId;
}

describe("mission-context document endpoint", () => {
  beforeEach(() => _clearResolverCache());

  it("serves the document body for a valid id", async () => {
    const root = makeProject();
    try {
      const { app } = harness(root, makeTask());
      const { body } = await fetchDoc(app, await specDocId(app));
      expect(body.status).toBe("ok");
      expect(body.document?.body).toContain("Demo plan");
      expect(body.document?.title).toBe("mini-plan.md");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  /*
   * External plan review (gemini #3 / openai #6, 2026-07-18) — MEDIUM.
   *
   * The signing key is PER-PROCESS, so every id minted before a server restart
   * stops verifying. That is benign and common, and the honest, actionable
   * answer is `stale` ("reopen the tab"), not an alarming 404 for an artifact
   * that is perfectly fine. A tampered id is indistinguishable from a
   * restart-expired one and reads the same — and crucially, NO read happens in
   * either case, so nothing is disclosed.
   */
  it("reports STALE for an unverifiable id (server restart, not an error)", async () => {
    const root = makeProject();
    try {
      const { app } = harness(root, makeTask());
      const { httpStatus, body } = await fetchDoc(app, "not-a-real-id");
      expect(httpStatus).toBe(200);
      expect(body.status).toBe("stale");
      expect(body.document).toBeUndefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("does NOT serve a document for a TAMPERED signature", async () => {
    const root = makeProject();
    try {
      const { app } = harness(root, makeTask());
      const valid = (await specDocId(app)) ?? "";
      const tampered = `${valid.slice(0, valid.lastIndexOf("."))}.AAAAAAAAAAAAAAAAAAAAAAAAAAAA`;
      const { body } = await fetchDoc(app, tampered);
      expect(body.status).toBe("stale");
      // The load-bearing assertion: no body is ever returned.
      expect(body.document).toBeUndefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("DENIES a validly-signed id whose `rel` is a traversal (guard, not just signature)", async () => {
    const root = makeProject();
    try {
      const { app } = harness(root, makeTask());
      const traversal = mintDocId({
        t: "task-1",
        s: UUID,
        p: root,
        r: RUN_ID,
        root,
        rel: "../../../../etc/passwd",
        rev: "x",
        f: "0:0",
      });
      const { body } = await fetchDoc(app, traversal);
      expect(body.status).not.toBe("ok");
      expect(body.document).toBeUndefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("DENIES an id minted for a different task (cross-task read)", async () => {
    const root = makeProject();
    try {
      const { app } = harness(root, makeTask());
      const crossTask = mintDocId({
        t: "task-OTHER",
        s: UUID,
        p: root,
        r: RUN_ID,
        root,
        rel: SPEC_REL,
        rev: "x",
        f: "0:0",
      });
      expect((await fetchDoc(app, crossTask)).httpStatus).toBe(404);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("DENIES an id minted against a different project root (cross-project read)", async () => {
    const root = makeProject();
    const other = makeProject();
    try {
      const { app } = harness(root, makeTask());
      const crossProject = mintDocId({
        t: "task-1",
        s: UUID,
        p: other,
        r: RUN_ID,
        root: other,
        rel: SPEC_REL,
        rev: "x",
        f: "0:0",
      });
      expect((await fetchDoc(app, crossProject)).httpStatus).toBe(404);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(other, { recursive: true, force: true });
    }
  });

  it("DENIES an id minted for a different SESSION on the same task", async () => {
    const root = makeProject();
    try {
      const { app } = harness(root, makeTask());
      const crossSession = mintDocId({
        t: "task-1",
        s: "99999999-8888-7777-6666-555555555555",
        p: root,
        r: RUN_ID,
        root,
        rel: SPEC_REL,
        rev: "x",
        f: "0:0",
      });
      expect((await fetchDoc(app, crossSession)).httpStatus).toBe(404);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("reports `stale` — not a 404 — when the document vanished after minting (AC3)", async () => {
    const root = makeProject();
    try {
      const { app } = harness(root, makeTask());
      const id = await specDocId(app);
      rmSync(join(root, ".shipwright", "planning", "iterate", RUN_ID), {
        recursive: true,
        force: true,
      });
      const { body } = await fetchDoc(app, id);
      expect(body.status).toBe("stale");
      expect(body.document).toBeUndefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
