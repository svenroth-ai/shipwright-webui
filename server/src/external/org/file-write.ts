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
import {
  readFileSync,
  writeFileSync,
  renameSync,
  unlinkSync,
  existsSync,
  lstatSync,
} from "node:fs";
import { dirname, join } from "node:path";

import { realPathGuard } from "../../core/path-guard.js";
import {
  resolveOrgAllowlistedTarget,
  type OrgAllowlistedKind,
} from "./_helpers.js";
import { fileFingerprint, unquoteEtag } from "../file/_helpers.js";
import {
  withDecisionsLock,
  OrgSymlinkEscapeError,
  type DecisionsLockDeps,
} from "./decisions-lock.js";

/** 2 MiB — org docs are small prose files, same cap as the project markdown write. */
export const ORG_WRITE_MAX_BYTES = 2 * 1024 * 1024;

const LOCKED_KINDS: ReadonlySet<OrgAllowlistedKind> = new Set([
  "decision_log",
  "decisions_proposed",
]);

type WriteOutcome =
  | { ok: true; status: 200; body: { written: true; fingerprint: string; size: number } }
  | { ok: false; status: number; body: Record<string, unknown> };

export interface OrgFileWriteDeps extends DecisionsLockDeps {
  lstatSync?: (path: string) => { isSymbolicLink(): boolean; isFile(): boolean };
  /** Injectable for tests; production wires the real `withDecisionsLock`. */
  withDecisionsLock?: typeof withDecisionsLock;
}

function performWrite(
  absoluteTarget: string,
  leadsRoot: string,
  relpath: string,
  body: string,
  ifMatch: string | undefined,
  lstat: (path: string) => { isSymbolicLink(): boolean; isFile(): boolean },
): WriteOutcome {
  let lst;
  try {
    lst = lstat(absoluteTarget);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") {
      return { ok: false, status: 404, body: { error: "not_found", path: relpath } };
    }
    return {
      ok: false,
      status: 500,
      body: { error: "file_stat_failed", detail: String(err).slice(0, 200) },
    };
  }
  if (lst.isSymbolicLink()) {
    return { ok: false, status: 403, body: { error: "symlink_forbidden", path: relpath } };
  }
  if (!lst.isFile()) {
    return { ok: false, status: 400, body: { error: "not_a_file", path: relpath } };
  }

  const realGuard = realPathGuard(leadsRoot, absoluteTarget);
  if (!realGuard.ok) {
    return {
      ok: false,
      status: 400,
      body: { error: "path_traversal", detail: realGuard.reason },
    };
  }

  if (!ifMatch) {
    return { ok: false, status: 400, body: { error: "precondition_required" } };
  }
  let current: Buffer;
  try {
    current = readFileSync(absoluteTarget);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") {
      return { ok: false, status: 404, body: { error: "not_found", path: relpath } };
    }
    return {
      ok: false,
      status: 500,
      body: { error: "file_read_failed", detail: String(err).slice(0, 200) },
    };
  }
  const currentFingerprint = fileFingerprint(current);
  if (unquoteEtag(ifMatch) !== currentFingerprint) {
    return {
      ok: false,
      status: 409,
      body: { error: "fingerprint_mismatch", currentFingerprint },
    };
  }

  const nextBuf = Buffer.from(body, "utf8");
  const tmp = join(dirname(absoluteTarget), `.org-write.tmp-${process.pid}-${Date.now()}`);
  try {
    writeFileSync(tmp, nextBuf);
    renameSync(tmp, absoluteTarget);
  } catch (err) {
    try {
      if (existsSync(tmp)) unlinkSync(tmp);
    } catch {
      /* swallow */
    }
    return {
      ok: false,
      status: 500,
      body: { error: "write_failed", detail: String(err).slice(0, 200), path: relpath },
    };
  }

  return {
    ok: true,
    status: 200,
    body: { written: true, fingerprint: fileFingerprint(nextBuf), size: nextBuf.length },
  };
}

export function registerOrgFileWrite(app: Hono, deps: OrgFileWriteDeps): void {
  const { leadsRoot } = deps;
  const lstat = deps.lstatSync ?? ((p: string) => lstatSync(p));
  const lockFn = deps.withDecisionsLock ?? withDecisionsLock;

  app.put("/api/external/org/file", async (c) => {
    const relpath = c.req.query("path");
    if (!relpath || relpath.length === 0) {
      return c.json({ error: "path_required" }, 400);
    }

    const target = resolveOrgAllowlistedTarget(leadsRoot, relpath);
    if (!target.ok) {
      const status = target.reason === "not_allowlisted" ? 403 : 400;
      const err = target.reason === "traversal" ? "path_traversal" : target.reason;
      return c.json({ error: err, detail: target.reason }, status);
    }

    const declaredLength = Number(c.req.header("content-length") ?? "");
    if (Number.isFinite(declaredLength) && declaredLength > ORG_WRITE_MAX_BYTES) {
      return c.json(
        { error: "payload_too_large", maxBytes: ORG_WRITE_MAX_BYTES, size: declaredLength },
        413,
      );
    }

    const body = await c.req.text();
    const byteLen = Buffer.byteLength(body, "utf8");
    if (byteLen > ORG_WRITE_MAX_BYTES) {
      return c.json(
        { error: "payload_too_large", maxBytes: ORG_WRITE_MAX_BYTES, size: byteLen },
        413,
      );
    }

    const ifMatch = c.req.header("if-match");

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
          return c.json({ error: "not_found", path: relpath }, 404);
        }
        return c.json(
          { error: "file_stat_failed", detail: String(err).slice(0, 200) },
          500,
        );
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
        // app-level errorHandler (middleware/error-handler.ts), which already
        // maps it to the same retryable 409 every other multi-writer state
        // file uses (CLAUDE.md DO-NOT #6).
        if (err instanceof OrgSymlinkEscapeError) {
          return c.json({ error: "symlink_forbidden", path: err.path }, 403);
        }
        throw err;
      }
    } else {
      outcome = performWrite(target.absolute, leadsRoot, relpath, body, ifMatch, lstat);
    }

    return c.json(outcome.body, outcome.status as 200 | 400 | 403 | 404 | 409 | 500);
  });
}
