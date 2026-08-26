/*
 * external/org/file-write.ts — PUT /api/external/org/file.
 *
 * Models `external/file/write.ts` almost exactly (extension-free here — the
 * allowlist IS the extension gate; atomic tmp+rename write; `If-Match`
 * optimistic concurrency; symlink rejection via injectable `lstat`), scoped
 * to `~/.claude/leads/**` instead of a project root.
 *
 * Plan-review fix (both external reviewers, HIGH): the card's "no lock"
 * exception applies to the FOUR lead-independent/charter docs
 * (`conventions.md`, `principal.md`, `AGENTS.md`, charter files) — it does
 * NOT extend to `decision_log.md` / `decisions-proposed.md`, which are the
 * exact two files the countersign action's FR-04.28 lock exists to
 * serialize against leadwright's daemon. Routing an unlocked write to
 * either through this generic allowlisted PUT would let the shared secret
 * alone bypass that lock. So: when the resolved target's `kind` is
 * `decision_log` or `decisions_proposed`, the read-check-write sequence
 * below runs INSIDE `withDecisionsLock` — same lock, same file, whichever
 * path reaches it. For the other four kinds, `If-Match` alone is the
 * concurrency story, exactly like `write.ts` — no cross-process contender.
 *
 * External-review fix (MEDIUM, spec): `withDecisionsLock` creates
 * `decisions-proposed.md` (empty) if missing, because THAT file is the lock
 * target itself and proper-lockfile needs it to exist — but the spec's
 * generic-PUT contract is edit-existing-only (mirrors `write.ts` exactly),
 * with no carve-out for the lock's own bootstrap need. A PUT to
 * `decisions-proposed.md` on a not-yet-bootstrapped org directory used to
 * auto-vivify it instead of 404ing, silently CREATING an allowlisted
 * document through what is supposed to be an edit-only endpoint. Fixed by
 * probing existence via `lstat` BEFORE ever calling `lockFn` — `lstat`
 * (unlike `existsSync`) does not follow symlinks, so a dangling symlink at
 * the target still reports as "exists" here and correctly falls through
 * into the lock's own `assertNotSymlink` defense rather than being
 * misclassified as merely missing.
 *
 * Status codes:
 *   400 traversal / absolute / missing path / missing If-Match / not-a-file
 *   403 symlink_forbidden — final path component is a symlink
 *   403 not_allowlisted — target is not one of the six allowed kinds
 *   404 missing target file
 *   409 fingerprint_mismatch, or ELOCKED (lock contention — errorHandler)
 *   413 body over ORG_WRITE_MAX_BYTES
 *   500 stat / read / write failure
 */

import type { Hono } from "hono";
import { lstatSync } from "node:fs";

import {
  resolveOrgAllowlistedTarget,
  type OrgAllowlistedKind,
} from "./_helpers.js";
import {
  withDecisionsLock,
  OrgSymlinkEscapeError,
  type DecisionsLockDeps,
} from "./decisions-lock.js";
import { performWrite, type WriteOutcome } from "./file-write-core.js";

/** 2 MiB — org docs are small prose files, same cap as the project markdown write. */
export const ORG_WRITE_MAX_BYTES = 2 * 1024 * 1024;

const LOCKED_KINDS: ReadonlySet<OrgAllowlistedKind> = new Set([
  "decision_log",
  "decisions_proposed",
]);

export interface OrgFileWriteDeps extends DecisionsLockDeps {
  lstatSync?: (path: string) => { isSymbolicLink(): boolean; isFile(): boolean };
  /** Injectable for tests; production wires the real `withDecisionsLock`. */
  withDecisionsLock?: typeof withDecisionsLock;
}

export type OrgFileWriteCoreResult =
  | { status: 200; body: { written: true; fingerprint: string; size: number } }
  | { status: 400 | 403 | 404 | 409 | 413 | 500; body: Record<string, unknown> };

export interface OrgFileWriteParams {
  relpath: string | undefined;
  contentLengthHeader: string | undefined;
  body: string;
  ifMatch: string | undefined;
}

/**
 * Pure core — shared by the secret-gated route and the plain-surface proxy.
 * Kind restriction (e.g. "only `charter` may pass through the browser-facing
 * proxy") is the CALLER's job, applied against `resolveOrgAllowlistedTarget`'s
 * `kind` before or after invoking this — this core stays as general as the
 * existing route (all six allowlisted kinds).
 */
export async function orgFileWriteCore(
  deps: OrgFileWriteDeps,
  params: OrgFileWriteParams,
): Promise<OrgFileWriteCoreResult> {
  const { leadsRoot } = deps;
  const lstat = deps.lstatSync ?? ((p: string) => lstatSync(p));
  const lockFn = deps.withDecisionsLock ?? withDecisionsLock;
  const { relpath, contentLengthHeader, body, ifMatch } = params;

  if (!relpath || relpath.length === 0) {
    return { status: 400, body: { error: "path_required" } };
  }

  const target = resolveOrgAllowlistedTarget(leadsRoot, relpath);
  if (!target.ok) {
    const status = target.reason === "not_allowlisted" ? 403 : 400;
    const err = target.reason === "traversal" ? "path_traversal" : target.reason;
    return { status, body: { error: err, detail: target.reason } };
  }

  const declaredLength = Number(contentLengthHeader ?? "");
  if (Number.isFinite(declaredLength) && declaredLength > ORG_WRITE_MAX_BYTES) {
    return {
      status: 413,
      body: { error: "payload_too_large", maxBytes: ORG_WRITE_MAX_BYTES, size: declaredLength },
    };
  }

  const byteLen = Buffer.byteLength(body, "utf8");
  if (byteLen > ORG_WRITE_MAX_BYTES) {
    return {
      status: 413,
      body: { error: "payload_too_large", maxBytes: ORG_WRITE_MAX_BYTES, size: byteLen },
    };
  }

  let outcome: WriteOutcome;
  if (LOCKED_KINDS.has(target.kind)) {
    // Pre-lock existence probe (external-review fix) — must run BEFORE
    // withDecisionsLock, since its own ensureFile() would otherwise
    // auto-vivify decisions-proposed.md first and hide a genuinely
    // missing target from performWrite's existence check.
    try {
      lstat(target.absolute);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code === "ENOENT") {
        return { status: 404, body: { error: "not_found", path: relpath } };
      }
      return {
        status: 500,
        body: { error: "file_stat_failed", detail: String(err).slice(0, 200) },
      };
    }

    try {
      outcome = await lockFn({ leadsRoot, lstatSync: deps.lstatSync }, () =>
        performWrite(target.absolute, leadsRoot, relpath, body, ifMatch, lstat),
      );
    } catch (err) {
      // Doubt-review fix: `withDecisionsLock` symlink-checks BOTH
      // decision_log.md and decisions-proposed.md (whichever one this PUT
      // targets, the OTHER is still checked because it shares the lock) —
      // uncaught, that 403-shaped condition fell through to the generic
      // 500 handler instead of the family's typed symlink_forbidden.
      // ELOCKED is deliberately NOT caught here: it propagates to the
      // caller (either the app-level errorHandler for the gated route, or
      // the new router's own catch, both of which map it to the same
      // retryable 409 every other multi-writer state file uses (CLAUDE.md
      // DO-NOT #6)).
      if (err instanceof OrgSymlinkEscapeError) {
        return { status: 403, body: { error: "symlink_forbidden", path: err.path } };
      }
      throw err;
    }
  } else {
    outcome = performWrite(target.absolute, leadsRoot, relpath, body, ifMatch, lstat);
  }

  return { status: outcome.status, body: outcome.body } as OrgFileWriteCoreResult;
}

export function registerOrgFileWrite(app: Hono, deps: OrgFileWriteDeps): void {
  app.put("/api/external/org/file", async (c) => {
    const relpath = c.req.query("path");
    const contentLengthHeader = c.req.header("content-length");

    // Bail before reading the request body when the declared Content-Length
    // alone already exceeds the cap — preserved from the pre-extraction
    // handler so an oversized upload is never buffered into memory just to
    // be rejected.
    const declaredLength = Number(contentLengthHeader ?? "");
    if (relpath && Number.isFinite(declaredLength) && declaredLength > ORG_WRITE_MAX_BYTES) {
      return c.json(
        { error: "payload_too_large", maxBytes: ORG_WRITE_MAX_BYTES, size: declaredLength },
        413,
      );
    }

    const result = await orgFileWriteCore(deps, {
      relpath,
      contentLengthHeader,
      body: await c.req.text(),
      ifMatch: c.req.header("if-match"),
    });
    return c.json(result.body, result.status as 200 | 400 | 403 | 404 | 409 | 413 | 500);
  });
}
