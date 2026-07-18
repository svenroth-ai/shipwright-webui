/*
 * core/mission-context/pointer.ts — read + VALIDATE the iterate bridge
 * `.shipwright/iterate_active/<sessionUuid>.json` (CONTRACT §5.1 a/b/e).
 *
 * Writer: the shared `worktree_isolation.py::write_run_pointer`, an
 * OUT-OF-PROCESS producer. Zero code read this file before Slice 1 — which is
 * exactly why the Mission tab could never resolve a standalone iterate.
 *
 * The pointer is UNTRUSTED INPUT. Two external reviews (Gemini + GPT) flagged
 * this surface, so validation is total and fails CLOSED:
 *   (a) `session_id` MUST equal the requested uuid — a stale pointer left by a
 *       previous session must never resurrect another session's artifacts;
 *   (b) `main_root` MUST equal the configured project root — blocks a pointer
 *       that would aim the resolver at a different repo;
 *   (e) anything else → typed `invalid`, and the caller does NOT persist it.
 *
 * `worktree_path` is NOT trusted here at all — membership in `git worktree
 * list` is checked by worktree-roots.ts, because filesystem containment is the
 * wrong test (a relocated worktree legitimately lives OUTSIDE the project
 * root — VERIFIED: the test-traceability-retrofit iterate relocated to a
 * sibling `wt-…` directory).
 *
 * The `run_id` / `slug` grammar is strict ASCII: those two strings are the ONLY
 * pointer-supplied values that ever reach a path join (via the KNOWN layout
 * `.shipwright/planning/iterate/<run_id>/…`, never a pointer-supplied
 * sub-path). Rejecting separators, dot-segments and non-ASCII here means the
 * traversal class is dead before path logic starts.
 */

import { existsSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";

import { pathGuard, realPathGuard } from "../path-guard.js";

/** Canonical lowercase-hex UUID — the pointer FILENAME grammar. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Strict id grammar: ASCII alnum start, then alnum / dot / underscore / dash,
 * 1..120 chars. Deliberately NOT a Unicode-tolerant class — a homoglyph or an
 * RTL override in a path segment is never legitimate here and is a known
 * smuggling vector. Any `..` sequence is rejected outright even though the
 * class permits a lone dot, so no dot-segment can survive.
 */
const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;

function isSafeId(v: unknown): v is string {
  if (typeof v !== "string" || v.length === 0) return false;
  if (!SAFE_ID_RE.test(v)) return false;
  if (v.includes("..")) return false;
  return true;
}

/** The `run_id` grammar (`iterate-<date>-<slug>`), strictly bounded. */
export function isSafeRunId(v: unknown): v is string {
  return isSafeId(v);
}

/** The `slug` grammar — same class as run_id. */
export function isSafeSlug(v: unknown): v is string {
  return isSafeId(v);
}

export function isSessionUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

/** The validated projection. Only these fields are ever used downstream. */
export interface IteratePointer {
  runId: string;
  slug: string;
  branch: string | null;
  /** As written — NOT yet trusted; worktree-roots.ts gates it on git membership. */
  worktreePath: string | null;
  mainRoot: string;
  sessionId: string;
  createdAt: string | null;
}

export type PointerInvalidReason =
  | "bad_session_uuid"
  | "malformed"
  | "session_mismatch"
  | "main_root_mismatch"
  | "bad_run_id"
  | "bad_slug"
  | "unreadable";

export type ReadPointerResult =
  | { status: "ok"; pointer: IteratePointer }
  | { status: "absent" }
  | { status: "invalid"; reason: PointerInvalidReason };

/**
 * Compare two absolute paths for "same directory". Uses realpath when the path
 * exists (so a junction / symlinked project root still matches) and falls back
 * to a normalized textual compare when it does not. Case-insensitive on win32
 * only — POSIX paths are case-sensitive and must stay so.
 */
export function samePath(a: string, b: string): boolean {
  const norm = (p: string): string => {
    let out = path.resolve(p);
    try {
      out = realpathSync(out);
    } catch {
      /* not on disk — fall back to the resolved form */
    }
    // Trailing separator is not significant for a directory identity.
    out = out.replace(/[\\/]+$/, "");
    return process.platform === "win32" ? out.toLowerCase() : out;
  };
  try {
    return norm(a) === norm(b);
  } catch {
    return false;
  }
}

/** Bounded read — a pointer is a handful of keys; anything larger is corrupt. */
const MAX_POINTER_BYTES = 64 * 1024;

/**
 * Read and validate the pointer for `sessionUuid` under `projectRoot`.
 *
 * Returns `absent` ONLY when there is genuinely no pointer (the common case:
 * a non-iterate session, or an iterate whose worktree was pruned). A file that
 * exists but cannot be trusted returns `invalid` with a reason — the caller
 * surfaces that as a typed `unavailable` artifact rather than a silent blank,
 * so a data-integrity problem never looks like "nothing exists" (§6).
 */
export function readIteratePointer(
  projectRoot: string,
  sessionUuid: string,
): ReadPointerResult {
  // The uuid becomes a FILENAME — validate before it reaches any join.
  if (!isSessionUuid(sessionUuid)) return { status: "invalid", reason: "bad_session_uuid" };

  // The pointer FILE itself is guarded before it is opened (external code
  // review, openai MEDIUM): a symlink at `iterate_active/<uuid>.json` pointing
  // outside the project would otherwise let a file we do not control decide
  // which run this session resolves to. The filename is uuid-validated above,
  // so pathGuard can only fail on a crafted root — but realPathGuard is the
  // one that matters here, and it runs before any read.
  const rel = [".shipwright", "iterate_active", `${sessionUuid}.json`].join("/");
  const guard = pathGuard(projectRoot, rel);
  if (!guard.ok) return { status: "invalid", reason: "unreadable" };
  if (!existsSync(guard.absolute)) return { status: "absent" };
  const real = realPathGuard(projectRoot, guard.absolute);
  if (!real.ok) return { status: "invalid", reason: "unreadable" };
  const file = real.absolute;

  let raw: string;
  try {
    raw = readFileSync(file, "utf-8");
  } catch {
    return { status: "invalid", reason: "unreadable" };
  }
  if (raw.length > MAX_POINTER_BYTES) return { status: "invalid", reason: "malformed" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { status: "invalid", reason: "malformed" };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { status: "invalid", reason: "malformed" };
  }
  const o = parsed as Record<string, unknown>;

  // (a) session binding — a stale pointer must not win.
  if (typeof o.session_id !== "string" || o.session_id.toLowerCase() !== sessionUuid.toLowerCase()) {
    return { status: "invalid", reason: "session_mismatch" };
  }

  // (b) project binding — the pointer must belong to THIS project root.
  if (typeof o.main_root !== "string" || !samePath(o.main_root, projectRoot)) {
    return { status: "invalid", reason: "main_root_mismatch" };
  }

  // The two values that reach a path join.
  if (!isSafeRunId(o.run_id)) return { status: "invalid", reason: "bad_run_id" };
  if (!isSafeSlug(o.slug)) return { status: "invalid", reason: "bad_slug" };

  return {
    status: "ok",
    pointer: {
      runId: o.run_id,
      slug: o.slug,
      branch: typeof o.branch === "string" ? o.branch : null,
      worktreePath: typeof o.worktree_path === "string" ? o.worktree_path : null,
      mainRoot: projectRoot,
      sessionId: sessionUuid,
      createdAt: typeof o.created_at === "string" ? o.created_at : null,
    },
  };
}
