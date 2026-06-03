/*
 * external/file/write.ts — PUT /api/external/projects/:projectId/file.
 *
 * The FIRST project-file write surface (iterate-2026-06-03-smartviewer-markdown-editor,
 * FR-01.34). Editing happens in the SmartViewer's TipTap rich-editor modal; the
 * serialized Markdown is written back here. Deliberately narrow:
 *
 *   - `.md` / `.markdown` ONLY (extension allowlist) — checked BEFORE touching
 *     the filesystem. This + the path-guard enforce the forbidden-path rules
 *     for free: `shipwright_run_config.json` isn't `.md`; `~/.claude` JSONL is
 *     outside the project root.
 *   - Target must already EXIST (Phase 1 edits existing docs; no create/rename).
 *   - Optimistic concurrency via a content-hash `If-Match` precondition — a stale
 *     fingerprint (e.g. a Claude session edited the same file in the embedded
 *     terminal) returns 409 instead of silently clobbering the change.
 *   - Atomic write: tmp in the SAME dir + rename (mirrors actions/upload.ts).
 *
 * Authz: this app has no per-request auth by design — it is loopback-bound,
 * project-scoped (`getProjectById`) and path-guarded, the same posture as the
 * GET `/file` route and the WS loopback-Origin gate (CLAUDE.md rule 10 / 17).
 *
 * Status codes:
 *   400 traversal / absolute / null-byte / missing path / missing If-Match / not-a-file
 *   404 missing project / missing target file
 *   409 fingerprint_mismatch (If-Match != current content hash)
 *   413 body over MARKDOWN_WRITE_MAX_BYTES (Content-Length precheck AND byte-accurate post-read)
 *   415 extension not in the markdown allowlist
 *   500 stat / read / write failure
 */

import type { Hono } from "hono";
import {
  readFileSync,
  writeFileSync,
  renameSync,
  unlinkSync,
  existsSync,
  statSync,
} from "node:fs";
import { dirname, extname, join } from "node:path";

import { pathGuard, realPathGuard } from "../../core/path-guard.js";
import type { ExternalRouteProjectView } from "../_shared/helpers.js";
import {
  MARKDOWN_WRITE_MAX_BYTES,
  MARKDOWN_WRITE_EXTENSIONS,
  fileFingerprint,
  unquoteEtag,
} from "./_helpers.js";

export interface MarkdownWriteDeps {
  getProjectById?: (id: string) => ExternalRouteProjectView | undefined;
}

export function registerMarkdownWrite(app: Hono, deps: MarkdownWriteDeps): void {
  const { getProjectById } = deps;

  app.put("/api/external/projects/:projectId/file", async (c) => {
    const projectId = c.req.param("projectId");
    const project = getProjectById?.(projectId);
    if (!project) {
      return c.json({ error: "project_not_found", projectId }, 404);
    }
    if (!project.path) {
      return c.json({ error: "project_path_unavailable", projectId }, 400);
    }

    const relpath = c.req.query("path");
    if (!relpath || relpath.length === 0) {
      return c.json({ error: "path_required" }, 400);
    }

    const guard = pathGuard(project.path, relpath);
    if (!guard.ok) {
      const err = guard.reason === "traversal" ? "path_traversal" : guard.reason;
      return c.json({ error: err, detail: guard.reason }, 400);
    }

    // Extension allowlist BEFORE any filesystem access — the markdown-only
    // write surface is the architectural boundary (review #6).
    const ext = extname(guard.absolute).toLowerCase().slice(1);
    if (!MARKDOWN_WRITE_EXTENSIONS.has(ext)) {
      return c.json({ error: "not_markdown", extension: ext || null }, 415);
    }

    // Pre-buffer DoS guard — reject before reading the body when the declared
    // Content-Length already exceeds the cap.
    const declaredLength = Number(c.req.header("content-length") ?? "");
    if (
      Number.isFinite(declaredLength) &&
      declaredLength > MARKDOWN_WRITE_MAX_BYTES
    ) {
      return c.json(
        { error: "payload_too_large", maxBytes: MARKDOWN_WRITE_MAX_BYTES, size: declaredLength },
        413,
      );
    }

    const body = await c.req.text();
    // Byte-accurate cap — NOT string length (multi-byte UTF-8; review #5).
    const byteLen = Buffer.byteLength(body, "utf8");
    if (byteLen > MARKDOWN_WRITE_MAX_BYTES) {
      return c.json(
        { error: "payload_too_large", maxBytes: MARKDOWN_WRITE_MAX_BYTES, size: byteLen },
        413,
      );
    }

    // Target must already exist + be a regular file.
    let st;
    try {
      st = statSync(guard.absolute);
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
    if (!st.isFile()) {
      return c.json({ error: "not_a_file", path: relpath }, 400);
    }

    // Symlink-escape defense — realpath re-check now that the target exists.
    const realGuard = realPathGuard(project.path, guard.absolute);
    if (!realGuard.ok) {
      return c.json({ error: "path_traversal", detail: realGuard.reason }, 400);
    }
    const target = realGuard.absolute;

    // Optimistic concurrency: hash the CURRENT on-disk bytes and compare to the
    // caller's If-Match. Missing precondition is a hard 400 (never blind-write).
    const ifMatch = c.req.header("if-match");
    if (!ifMatch) {
      return c.json({ error: "precondition_required" }, 400);
    }
    let current: Buffer;
    try {
      current = readFileSync(target);
    } catch (err) {
      // TOCTOU: the file may have been removed between statSync and here
      // (external review #7) — treat a vanished target as 404, not 500.
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code === "ENOENT") {
        return c.json({ error: "not_found", path: relpath }, 404);
      }
      return c.json(
        { error: "file_read_failed", detail: String(err).slice(0, 200) },
        500,
      );
    }
    const currentFingerprint = fileFingerprint(current);
    if (unquoteEtag(ifMatch) !== currentFingerprint) {
      return c.json({ error: "fingerprint_mismatch", currentFingerprint }, 409);
    }

    // Atomic write: tmp in the SAME directory (cross-device rename + collision
    // safety, review #3) then rename over the target.
    const nextBuf = Buffer.from(body, "utf8");
    const tmp = join(dirname(target), `.md-write.tmp-${process.pid}-${Date.now()}`);
    try {
      writeFileSync(tmp, nextBuf);
      renameSync(tmp, target);
    } catch (err) {
      try {
        if (existsSync(tmp)) unlinkSync(tmp);
      } catch {
        /* swallow */
      }
      return c.json(
        { error: "write_failed", detail: String(err).slice(0, 200), path: relpath },
        500,
      );
    }

    return c.json({
      written: true,
      fingerprint: fileFingerprint(nextBuf),
      size: nextBuf.length,
    });
  });
}
