/*
 * external/design-review/feedback-write.ts —
 * POST /api/external/projects/:projectId/design-feedback.
 *
 * The new (second) project-file write surface. The hosted viewer's Export posts
 * its contract-shaped markdown to the WebUI host; the host POSTs it here and the
 * server writes `.shipwright/designs/design-feedback-round{N}.md` into the
 * worktree (AC2), with:
 *
 *   - N computed from the round files already on disk (AC3), NOT the body.
 *   - the heading round integer normalized to N, every other byte preserved so
 *     the monorepo Option-B reader still parses it (AC4).
 *   - a contract guard (`looksLikeDesignFeedback`) — a non-feedback body is 400.
 *   - `.md` fixed name, size-capped, exclusive create with retry so two tabs
 *     racing the same N don't clobber a round (plan review R6).
 *
 * WebUI writes ONLY this transient scratch file (gitignored, monorepo #355) —
 * never run_config, run_loop_state, or Claude JSONL.
 *
 * Status codes:
 *   400 path/body missing · not_design_feedback · designs_dir_missing
 *   404 project_not_found
 *   409 round_write_contended (lost every exclusive-create retry)
 *   413 body over the size cap
 *   500 stat / write failure
 */

import { Hono } from "hono";
import {
  writeFileSync,
  unlinkSync,
  existsSync,
  statSync,
  readdirSync,
} from "node:fs";
import path from "node:path";

import { realPathGuard } from "../../core/path-guard.js";
import {
  computeNextRound,
  roundFileName,
  normalizeRoundHeading,
  looksLikeDesignFeedback,
} from "../../core/design-feedback.js";
import { MARKDOWN_WRITE_MAX_BYTES, fileFingerprint } from "../file/_helpers.js";
import type { ExternalRouteProjectView } from "../_shared/helpers.js";

export interface DesignFeedbackWriteDeps {
  getProjectById?: (id: string) => ExternalRouteProjectView | undefined;
}

/** Bounded retry for the two-tab same-N race: recompute N and re-attempt the
 *  exclusive create. Small because contention is a narrow multi-tab edge. */
const MAX_ROUND_ATTEMPTS = 8;

export function registerDesignFeedbackWrite(
  app: Hono,
  deps: DesignFeedbackWriteDeps,
): void {
  const { getProjectById } = deps;

  app.post("/api/external/projects/:projectId/design-feedback", async (c) => {
    const projectId = c.req.param("projectId");
    const project = getProjectById?.(projectId);
    if (!project) {
      return c.json({ error: "project_not_found", projectId }, 404);
    }
    if (!project.path) {
      return c.json({ error: "project_path_unavailable", projectId }, 400);
    }

    // Content-Length precheck before buffering.
    const declaredLength = Number(c.req.header("content-length") ?? "");
    if (Number.isFinite(declaredLength) && declaredLength > MARKDOWN_WRITE_MAX_BYTES) {
      return c.json(
        { error: "payload_too_large", maxBytes: MARKDOWN_WRITE_MAX_BYTES, size: declaredLength },
        413,
      );
    }

    const body = await c.req.text();
    const byteLen = Buffer.byteLength(body, "utf8");
    if (byteLen > MARKDOWN_WRITE_MAX_BYTES) {
      return c.json(
        { error: "payload_too_large", maxBytes: MARKDOWN_WRITE_MAX_BYTES, size: byteLen },
        413,
      );
    }
    if (!looksLikeDesignFeedback(body)) {
      return c.json({ error: "not_design_feedback" }, 400);
    }

    // The designs dir must already exist (the design phase created it). Realpath
    // it so a symlinked `.shipwright`/`designs` cannot redirect the write.
    const designsRoot = path.join(project.path, ".shipwright", "designs");
    let dirStat;
    try {
      dirStat = statSync(designsRoot);
    } catch {
      return c.json({ error: "designs_dir_missing" }, 400);
    }
    if (!dirStat.isDirectory()) {
      return c.json({ error: "designs_dir_missing" }, 400);
    }
    const realDir = realPathGuard(project.path, designsRoot);
    if (!realDir.ok) {
      return c.json({ error: "path_traversal", detail: realDir.reason }, 400);
    }
    const dir = realDir.absolute;

    let lastRound = 0;
    for (let attempt = 0; attempt < MAX_ROUND_ATTEMPTS; attempt++) {
      let round: number;
      try {
        round = computeNextRound(readdirSync(dir));
      } catch (err) {
        return c.json({ error: "readdir_failed", detail: String(err).slice(0, 200) }, 500);
      }
      lastRound = round;
      const fileName = roundFileName(round);
      const target = path.join(dir, fileName);
      const normalized = normalizeRoundHeading(body, round);
      const nextBuf = Buffer.from(normalized, "utf8");

      // Exclusive create WITH content in ONE syscall (review #1): `wx` fails with
      // EEXIST if another tab already claimed this round (→ recompute N + retry),
      // and there is never a 0-byte round file on disk (O_EXCL create + the
      // content write are the same open). O_EXCL also defeats a pre-planted
      // symlink at the round name.
      try {
        writeFileSync(target, nextBuf, { flag: "wx" });
      } catch (err) {
        const code = (err as NodeJS.ErrnoException)?.code;
        if (code === "EEXIST") continue; // another tab won this round; recompute
        // Non-EEXIST failure: O_EXCL means any file at `target` is ours — best
        // effort remove a partial before surfacing the error.
        try {
          if (existsSync(target)) unlinkSync(target);
        } catch {
          /* swallow */
        }
        return c.json({ error: "write_failed", detail: String(err).slice(0, 200) }, 500);
      }

      return c.json({
        written: true,
        round,
        path: `.shipwright/designs/${fileName}`,
        fingerprint: fileFingerprint(nextBuf),
        size: nextBuf.length,
      });
    }

    // Lost every retry — extreme contention. The client can re-POST.
    return c.json({ error: "round_write_contended", lastRound }, 409);
  });
}
