/*
 * external/org/beat-steps-read.ts — reads one beat's `steps.jsonl`
 * (iterate-2026-09-08-lead-inventory-page, AC-1/AC-2b/AC-10/AC-11).
 *
 * Mirrors `audit-log.ts`'s exact open-first pattern: `pathGuard` →
 * `open(O_RDONLY | O_NOFOLLOW)` → `fstat().isFile()` → `realPathGuard` →
 * read from the held fd. Both `leadId` AND `beatId` are re-validated HERE,
 * not just trusted from an upstream caller — `beatId` comes from
 * `beat-register.json`, itself only `typeof === "string"`-checked at write
 * time (Internal Plan Review finding #5). leadwright generates beat ids via
 * `randomUUID()` (`lib/beat-round.ts` / `daemon/tick.ts`, verified) — hence
 * `BEAT_ID_RE`.
 *
 * Reporting steps is OPTIONAL in the beat protocol (`skills/leadwright/
 * SKILL.md` step 5) — ENOENT (no file at all) is `ok` with an empty array,
 * the normal, unremarkable case. A genuine file-level failure (symlink,
 * non-file, read error) is `unreadable` — NEVER collapsed into "empty"
 * (Internal Plan Review finding #2). Individual malformed/semantically
 * invalid JSONL lines are skipped and counted in `unreadableLines`; when
 * EVERY line fails, the result is still `ok` with `steps:[]` and a nonzero
 * `unreadableLines` — the CALLER (composite/UI) is responsible for
 * rendering that distinctly from a genuinely empty contribution (AC-10),
 * this reader's job is only to report the count honestly.
 */

import { closeSync, constants as fsConstants, fstatSync, openSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { pathGuard, realPathGuard } from "../../core/path-guard.js";
import { LEAD_ID_RE } from "./_helpers.js";
import { isValidBeatStep, type BeatStep } from "../../types/leadwright-beat-step.js";

export const BEAT_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ReadBeatStepsResult =
  | { status: "ok"; steps: BeatStep[]; unreadableLines: number }
  | { status: "unreadable" };

export interface BeatStepsReadDeps {
  leadsRoot: string;
  /** Test seam for the O_NOFOLLOW open — defaults to the real `openSync`. */
  openSync?: typeof openSync;
}

export function readBeatStepsCore(
  deps: BeatStepsReadDeps,
  leadId: string,
  beatId: string,
): ReadBeatStepsResult {
  const { leadsRoot } = deps;
  const open = deps.openSync ?? openSync;

  if (!LEAD_ID_RE.test(leadId) || !BEAT_ID_RE.test(beatId)) {
    return { status: "unreadable" };
  }

  const guard = pathGuard(leadsRoot, join(leadId, "beats", beatId, "steps.jsonl"));
  if (!guard.ok) {
    return { status: "unreadable" };
  }

  let fd: number;
  try {
    fd = open(guard.absolute, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") {
      return { status: "ok", steps: [], unreadableLines: 0 };
    }
    return { status: "unreadable" };
  }

  try {
    if (!fstatSync(fd).isFile()) {
      return { status: "unreadable" };
    }
    const realGuard = realPathGuard(leadsRoot, guard.absolute);
    if (!realGuard.ok) {
      return { status: "unreadable" };
    }

    const text = readFileSync(fd, "utf8");
    const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);

    const steps: BeatStep[] = [];
    let unreadableLines = 0;
    for (const line of lines) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        unreadableLines += 1;
        continue;
      }
      if (isValidBeatStep(parsed)) {
        steps.push(parsed);
      } else {
        unreadableLines += 1;
      }
    }

    return { status: "ok", steps, unreadableLines };
  } catch {
    return { status: "unreadable" };
  } finally {
    closeSync(fd);
  }
}
