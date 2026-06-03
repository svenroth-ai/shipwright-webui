/*
 * file-write-route.test.ts — PUT /api/external/projects/:projectId/file
 * (iterate-2026-06-03-smartviewer-markdown-editor, FR-01.34).
 *
 * Covers the markdown write surface contract:
 *   - GET emits a quoted sha256 ETag (the If-Match token)
 *   - 415 non-markdown extension (no write)
 *   - 400 traversal / missing If-Match
 *   - 404 missing project / missing target / not-a-file (400)
 *   - 409 stale If-Match (no write)
 *   - 413 byte-accurate oversize body (multi-byte)
 *   - 200 happy path: atomic write, returned fingerprint matches next GET ETag,
 *     no tmp residue; empty body accepted
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  mkdirSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

import {
  SdkSessionsStore,
  type SdkSessionsStoreDeps,
} from "../core/sdk-sessions-store.js";
import { SessionWatcher } from "../core/session-watcher.js";
import { createExternalRoutes, type ExternalRouteProjectView } from "./routes.js";
import { __clearGitignoreCacheForTests } from "../core/gitignore-cache.js";
import { fileFingerprint } from "./file/_helpers.js";

function inMemoryDeps(): SdkSessionsStoreDeps {
  const files = new Map<string, string>();
  const existing = new Set<string>();
  return {
    readFile: async (p) => {
      if (!files.has(p)) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      return files.get(p)!;
    },
    writeFile: async (p, data) => {
      files.set(p, data);
      existing.add(p);
    },
    existsSync: (p) => existing.has(p),
    mkdirSync: (p) => {
      existing.add(p);
    },
    ensureFile: (p) => {
      if (!files.has(p)) files.set(p, "");
      existing.add(p);
    },
  };
}

describe("PUT /api/external/projects/:projectId/file (markdown write, FR-01.34)", () => {
  let app: Hono;
  let projectDir: string;
  const projectId = "p-md-write";

  beforeEach(async () => {
    projectDir = mkdtempSync(path.join(tmpdir(), "md-write-test-"));
    mkdirSync(path.join(projectDir, "docs"), { recursive: true });
    mkdirSync(path.join(projectDir, "folder.md"), { recursive: true }); // dir w/ .md name
    writeFileSync(path.join(projectDir, "README.md"), "# hi\n", "utf8");
    writeFileSync(path.join(projectDir, "notes.txt"), "plain\n", "utf8");
    __clearGitignoreCacheForTests();

    const store = new SdkSessionsStore("/store/sdk-sessions.json", inMemoryDeps());
    await store.load();
    const watcher = new SessionWatcher({ projectsDir: projectDir });
    const project: ExternalRouteProjectView = {
      id: projectId,
      name: "test",
      path: projectDir,
    };
    app = new Hono();
    app.route(
      "/",
      createExternalRoutes({
        store,
        watcher,
        getProjectById: (id) => (id === projectId ? project : undefined),
        ptyManager: { get: () => undefined },
      }),
    );
  });

  afterEach(() => {
    try {
      rmSync(projectDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  const fileUrl = (p: string) =>
    `/api/external/projects/${projectId}/file?path=${encodeURIComponent(p)}`;

  async function getEtag(p: string): Promise<string> {
    const r = await app.request(fileUrl(p));
    expect(r.status).toBe(200);
    const etag = r.headers.get("etag");
    expect(etag).toBeTruthy();
    return etag!;
  }

  function readDoc(p: string): string {
    return readFileSync(path.join(projectDir, p), "utf8");
  }

  it("GET emits a quoted sha256 ETag", async () => {
    const r = await app.request(fileUrl("README.md"));
    expect(r.status).toBe(200);
    expect(r.headers.get("etag")).toMatch(/^"sha256:[0-9a-f]{64}"$/);
  });

  it("rejects a non-markdown extension with 415 (no write)", async () => {
    const r = await app.request(fileUrl("notes.txt"), {
      method: "PUT",
      headers: { "If-Match": '"sha256:whatever"' },
      body: "hacked",
    });
    expect(r.status).toBe(415);
    expect(readDoc("notes.txt")).toBe("plain\n");
  });

  it("rejects path traversal with 400", async () => {
    const r = await app.request(fileUrl("../escape.md"), {
      method: "PUT",
      headers: { "If-Match": '"x"' },
      body: "x",
    });
    expect(r.status).toBe(400);
  });

  it("returns 404 for a missing project", async () => {
    const r = await app.request(
      `/api/external/projects/nope/file?path=README.md`,
      { method: "PUT", headers: { "If-Match": '"x"' }, body: "x" },
    );
    expect(r.status).toBe(404);
  });

  it("returns 404 for a missing target file", async () => {
    const r = await app.request(fileUrl("docs/missing.md"), {
      method: "PUT",
      headers: { "If-Match": '"x"' },
      body: "x",
    });
    expect(r.status).toBe(404);
  });

  it("returns 400 not_a_file for a directory with a .md name", async () => {
    const r = await app.request(fileUrl("folder.md"), {
      method: "PUT",
      headers: { "If-Match": '"x"' },
      body: "x",
    });
    expect(r.status).toBe(400);
    expect((await r.json()).error).toBe("not_a_file");
  });

  it("returns 400 when If-Match is absent (never blind-writes)", async () => {
    const r = await app.request(fileUrl("README.md"), {
      method: "PUT",
      body: "# changed\n",
    });
    expect(r.status).toBe(400);
    expect((await r.json()).error).toBe("precondition_required");
    expect(readDoc("README.md")).toBe("# hi\n");
  });

  it("returns 409 on a stale If-Match (no write)", async () => {
    const r = await app.request(fileUrl("README.md"), {
      method: "PUT",
      headers: { "If-Match": '"sha256:deadbeef"' },
      body: "# changed\n",
    });
    expect(r.status).toBe(409);
    const j = await r.json();
    expect(j.error).toBe("fingerprint_mismatch");
    expect(j.currentFingerprint).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(readDoc("README.md")).toBe("# hi\n");
  });

  it("writes atomically on a matching If-Match and returns the new fingerprint", async () => {
    const etag = await getEtag("README.md");
    const next = "# Updated\n\nNew body.\n";
    const r = await app.request(fileUrl("README.md"), {
      method: "PUT",
      headers: { "If-Match": etag },
      body: next,
    });
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.written).toBe(true);
    expect(j.fingerprint).toBe(fileFingerprint(Buffer.from(next, "utf8")));
    expect(readDoc("README.md")).toBe(next);

    // The next GET's ETag equals the returned fingerprint (round-trip stable).
    expect(await getEtag("README.md")).toBe(`"${j.fingerprint}"`);
    // No tmp residue left behind.
    expect(readdirSync(projectDir).some((f) => f.startsWith(".md-write.tmp"))).toBe(false);
  });

  it("accepts an empty body (file becomes empty)", async () => {
    const etag = await getEtag("README.md");
    const r = await app.request(fileUrl("README.md"), {
      method: "PUT",
      headers: { "If-Match": etag },
      body: "",
    });
    expect(r.status).toBe(200);
    expect(readDoc("README.md")).toBe("");
  });

  it("returns 413 for an oversize body (byte-accurate, multi-byte)", async () => {
    // '€' is 3 bytes in UTF-8; ~1M of them ≈ 3 MB > the 2 MiB cap.
    const big = "€".repeat(1_000_000);
    const r = await app.request(fileUrl("README.md"), {
      method: "PUT",
      headers: { "If-Match": '"x"' },
      body: big,
    });
    expect(r.status).toBe(413);
    expect(readDoc("README.md")).toBe("# hi\n");
  });
});
