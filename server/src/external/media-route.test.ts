/*
 * media-route.test.ts — GET /api/external/projects/:projectId/media
 * (iterate-2026-06-03-smartviewer-video-view, AC1–AC5).
 *
 * Range-streaming contract:
 *   - No Range header        → 200 + full body + Accept-Ranges: bytes
 *   - Range: bytes=a-b       → 206 + Content-Range + byte-exact slice
 *   - Open / suffix ranges   → 206 with computed bounds
 *   - Unsatisfiable range    → 416 + Content-Range: bytes * /size
 *   - Non-video extension    → 415 unsupported_media_type
 *   - Path-guard parity with /file (traversal / absolute / dir / missing)
 *
 * A 100-byte fixture whose byte[i] === i lets every range assertion check
 * the EXACT slice, not just the length.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

import {
  SdkSessionsStore,
  type SdkSessionsStoreDeps,
} from "../core/sdk-sessions-store.js";
import { SessionWatcher } from "../core/session-watcher.js";
import { createExternalRoutes, type ExternalRouteProjectView } from "./routes.js";
import { __clearGitignoreCacheForTests } from "../core/gitignore-cache.js";

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

/** byte[i] === i (0..99) — deterministic slice assertions. */
const RAMP = Buffer.alloc(100);
for (let i = 0; i < RAMP.length; i++) RAMP[i] = i;

describe("GET /api/external/projects/:projectId/media (video streaming)", () => {
  let app: Hono;
  let projectDir: string;
  const projectId = "p-media-test";

  beforeEach(async () => {
    projectDir = mkdtempSync(path.join(tmpdir(), "media-route-test-"));
    mkdirSync(path.join(projectDir, "src"), { recursive: true });
    writeFileSync(path.join(projectDir, "clip.mp4"), RAMP);
    writeFileSync(path.join(projectDir, "clip.m4v"), RAMP);
    writeFileSync(path.join(projectDir, "clip.webm"), RAMP);
    writeFileSync(path.join(projectDir, "clip.ogv"), RAMP);
    writeFileSync(path.join(projectDir, "clip.ogg"), RAMP);
    writeFileSync(path.join(projectDir, "clip.mov"), RAMP);
    writeFileSync(path.join(projectDir, "notes.txt"), "not a video\n");

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

  const url = (p: string) =>
    `/api/external/projects/${projectId}/media?path=${encodeURIComponent(p)}`;

  it("404 unknown project id", async () => {
    const res = await app.request(
      "/api/external/projects/nope/media?path=clip.mp4",
    );
    expect(res.status).toBe(404);
  });

  it("400 missing ?path parameter", async () => {
    const res = await app.request(`/api/external/projects/${projectId}/media`);
    expect(res.status).toBe(400);
  });

  it("AC1: 200 full body + Accept-Ranges + video MIME when no Range header", async () => {
    const res = await app.request(url("clip.mp4"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("video/mp4");
    expect(res.headers.get("accept-ranges")).toBe("bytes");
    expect(res.headers.get("content-length")).toBe("100");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.length).toBe(100);
    expect(buf.equals(RAMP)).toBe(true);
  });

  it("AC2: 206 with byte-exact slice for Range: bytes=10-19", async () => {
    const res = await app.request(url("clip.mp4"), {
      headers: { Range: "bytes=10-19" },
    });
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe("bytes 10-19/100");
    expect(res.headers.get("content-length")).toBe("10");
    expect(res.headers.get("accept-ranges")).toBe("bytes");
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.length).toBe(10);
    expect(buf.equals(RAMP.subarray(10, 20))).toBe(true);
  });

  it("AC2: 206 open-ended Range: bytes=90- streams to EOF", async () => {
    const res = await app.request(url("clip.mp4"), {
      headers: { Range: "bytes=90-" },
    });
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe("bytes 90-99/100");
    expect(res.headers.get("content-length")).toBe("10");
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.equals(RAMP.subarray(90, 100))).toBe(true);
  });

  it("AC2: 206 suffix Range: bytes=-10 returns last 10 bytes", async () => {
    const res = await app.request(url("clip.mp4"), {
      headers: { Range: "bytes=-10" },
    });
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe("bytes 90-99/100");
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.equals(RAMP.subarray(90, 100))).toBe(true);
  });

  it("AC2: 206 clamps an over-long end to size-1 (bytes=95-200)", async () => {
    const res = await app.request(url("clip.mp4"), {
      headers: { Range: "bytes=95-200" },
    });
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe("bytes 95-99/100");
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.equals(RAMP.subarray(95, 100))).toBe(true);
  });

  it("AC3: 416 unsatisfiable Range (start >= size) with Content-Range: bytes */size", async () => {
    const res = await app.request(url("clip.mp4"), {
      headers: { Range: "bytes=200-300" },
    });
    expect(res.status).toBe(416);
    expect(res.headers.get("content-range")).toBe("bytes */100");
  });

  it("AC3: 416 unsatisfiable Range (start > end, bytes=20-10)", async () => {
    const res = await app.request(url("clip.mp4"), {
      headers: { Range: "bytes=20-10" },
    });
    expect(res.status).toBe(416);
    expect(res.headers.get("content-range")).toBe("bytes */100");
  });

  it("AC2: malformed Range header is ignored → 200 full body", async () => {
    const res = await app.request(url("clip.mp4"), {
      headers: { Range: "rows=1-2" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-length")).toBe("100");
  });

  it.each([
    ["mp4", "video/mp4"],
    ["m4v", "video/x-m4v"],
    ["webm", "video/webm"],
    ["ogv", "video/ogg"],
    ["ogg", "video/ogg"],
    ["mov", "video/quicktime"],
  ])("AC4: clip.%s → Content-Type %s", async (ext, mime) => {
    const res = await app.request(url(`clip.${ext}`));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe(mime);
  });

  it("AC4: 415 non-video extension (.txt)", async () => {
    const res = await app.request(url("notes.txt"));
    expect(res.status).toBe(415);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("unsupported_media_type");
  });

  it("AC5: 400 traversal ?path=../etc/passwd", async () => {
    const res = await app.request(url("../etc/passwd"));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("path_traversal");
  });

  it("AC5: 400 absolute ?path=/etc/passwd", async () => {
    const res = await app.request(url("/etc/passwd"));
    expect(res.status).toBe(400);
  });

  it("AC5: 404 missing file", async () => {
    const res = await app.request(url("does-not-exist.mp4"));
    expect(res.status).toBe(404);
  });

  it("AC5: 400 not_a_file on a directory", async () => {
    // src has no extension → 415 would mask the dir check; use a dir named
    // with a video extension to exercise the not_a_file branch explicitly.
    mkdirSync(path.join(projectDir, "movies.mp4"), { recursive: true });
    const res = await app.request(url("movies.mp4"));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("not_a_file");
  });
});
