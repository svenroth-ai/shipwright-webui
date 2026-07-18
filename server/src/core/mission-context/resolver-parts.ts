/*
 * core/mission-context/resolver-parts.ts — pure helpers + the read-through
 * cache for the resolver.
 *
 * Split out of `resolver.ts` to keep both files within the size rule. These are
 * the revision / caching / response-shape primitives; the orchestration that
 * uses them stays in resolver.ts.
 */

import { createHash } from "node:crypto";
import { statSync } from "node:fs";

import { readBoundedFile } from "./fs-read.js";

import { MAX_DOC_BYTES } from "./worktree-roots.js";
import {
  MISSION_CONTEXT_SCHEMA_VERSION,
  type ArtifactDescriptor,
  type MissionContext,
} from "./types.js";

/**
 * mtime+size fingerprint of every source a response depends on.
 *
 * `paths` MUST include the iterate document and the per-run agent-doc, not just
 * the adopted spec + event log: editing only `mini-plan.md` would otherwise
 * leave the rev (and therefore the cache) unchanged, serving a stale planned
 * requirement and a stale document id (external code review, openai MEDIUM).
 */
export function computeSourceRev(paths: string[], extra: (string | number)[]): string {
  const h = createHash("sha256");
  for (const p of paths) {
    try {
      const st = statSync(p);
      h.update(`${p}:${st.mtimeMs}:${st.size}`);
    } catch {
      h.update(`${p}:absent`);
    }
  }
  for (const e of extra) h.update(`|${e}`);
  return h.digest("hex").slice(0, 16);
}

/**
 * Per-document fingerprint embedded in the opaque id.
 *
 * The context-wide rev is not enough for AC3 — it is derived from the adopted
 * spec + event log, so editing only the iterate document would leave it
 * unchanged and the detail endpoint would serve the NEW body as `ok`. This is
 * compared at read time, so a changed document reports `stale`.
 */
export function docFingerprint(absolute: string): string {
  try {
    const st = statSync(absolute);
    return `${st.size}:${st.mtimeMs}`;
  } catch {
    return "absent";
  }
}

/**
 * The three Slice-1 artifacts, all typed `unavailable` with one honest note.
 *
 * Used for the integrity cases (a pointer that failed validation, a worktree
 * git does not recognise): AC5 requires those to SHOW as unavailable rather
 * than fall through to a silent "nothing here".
 */
export function unavailableArtifacts(note: string): ArtifactDescriptor[] {
  return [
    {
      kind: "spec",
      label: "Spec",
      state: "unavailable",
      summary: null,
      receipt: null,
      note,
      detail: null,
    },
    {
      kind: "requirement",
      label: "Requirement",
      state: "unavailable",
      summary: null,
      receipt: null,
      note,
      detail: null,
    },
    {
      kind: "commit",
      label: "Commit",
      state: "unavailable",
      summary: null,
      receipt: null,
      note,
      detail: null,
    },
  ];
}

interface CacheEntry {
  rev: string;
  context: MissionContext;
}

/** Read-through cache keyed `{projectRoot, sessionUuid, runId}`, validated by `rev`. */
export const cache = new Map<string, CacheEntry>();
export const CACHE_CAP = 256;

/** Test-only: drop the module-level cache between cases. */
export function _clearResolverCache(): void {
  cache.clear();
}

/**
 * Bounded read of a document body (mid-run planned impact + the detail
 * endpoint). Atomic: the size cap is enforced against the SAME descriptor the
 * bytes come from, so a swapped path cannot slip past it (CodeQL
 * js/file-system-race).
 */
export function readBounded(absolute: string): string | null {
  return readBoundedFile(absolute, MAX_DOC_BYTES)?.text ?? null;
}

/** A context with no artifacts — the shape every non-iterate scenario returns. */
export function emptyContext(
  scenario: MissionContext["scenario"],
  missionTabVisible: boolean,
  sourceRev: string,
): MissionContext {
  return {
    schemaVersion: MISSION_CONTEXT_SCHEMA_VERSION,
    scenario,
    missionTabVisible,
    runId: null,
    artifacts: [],
    tests: null,
    servesFrId: null,
    sourceRev,
  };
}
