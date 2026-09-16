/*
 * core/codex-thread-discovery.test.ts — filename-first Codex threadId
 * discovery (Codex Light §4).
 */
import { describe, expect, it } from "vitest";
import path from "node:path";

import { discoverCodexThreadId, codexSessionsRoot, type CodexThreadDiscoveryDeps } from "./codex-thread-discovery.js";

function sessionMetaLine(id: string, cwd: string): string {
  return JSON.stringify({
    timestamp: "2026-09-16T05:32:17.468Z",
    type: "session_meta",
    payload: { session_id: "parent", id, cwd },
  });
}

/** In-memory fake — `dirs` maps a day folder (relative to sessions root) to its filenames; `heads` maps an absolute file path to its first-line content. */
function fakeDeps(dirs: Record<string, string[]>, heads: Record<string, string>): CodexThreadDiscoveryDeps {
  const homeDir = () => "/home/u";
  const root = codexSessionsRoot({ homeDir });
  return {
    homeDir,
    readdir: async (dir) => {
      const rel = path.relative(root, dir).split(path.sep).join("/");
      if (!(rel in dirs)) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      return dirs[rel];
    },
    readHead: async (filePath) => {
      if (!(filePath in heads)) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      return heads[filePath];
    },
  };
}

describe("discoverCodexThreadId", () => {
  it("finds the thread id from a rollout file matching cwd, at/after sinceIso", async () => {
    const file = path.join("/home/u", ".codex", "sessions", "2026", "09", "16", "rollout-2026-09-16T07-32-17-01a0a8b3-9870-7e22-86c3-19657c54a224.jsonl");
    const deps = fakeDeps(
      { "2026/09/16": ["rollout-2026-09-16T07-32-17-01a0a8b3-9870-7e22-86c3-19657c54a224.jsonl"] },
      { [file]: sessionMetaLine("01a0a8b3-9870-7e22-86c3-19657c54a224", "/tmp/proj") + "\n{\"more\":true}" },
    );
    const result = await discoverCodexThreadId(
      { cwd: "/tmp/proj", sinceIso: "2026-09-16T05:00:00.000Z" },
      deps,
    );
    expect(result).toBe("01a0a8b3-9870-7e22-86c3-19657c54a224");
  });

  it("returns null when no rollout file matches the cwd", async () => {
    const file = path.join("/home/u", ".codex", "sessions", "2026", "09", "16", "rollout-2026-09-16T07-32-17-01a0a8b3-9870-7e22-86c3-19657c54a224.jsonl");
    const deps = fakeDeps(
      { "2026/09/16": ["rollout-2026-09-16T07-32-17-01a0a8b3-9870-7e22-86c3-19657c54a224.jsonl"] },
      { [file]: sessionMetaLine("01a0a8b3-9870-7e22-86c3-19657c54a224", "/tmp/OTHER-project") },
    );
    const result = await discoverCodexThreadId(
      { cwd: "/tmp/proj", sinceIso: "2026-09-16T05:00:00.000Z" },
      deps,
    );
    expect(result).toBeNull();
  });

  it("matches cwd case-insensitively and across backslash/forward-slash separators", async () => {
    const file = path.join("/home/u", ".codex", "sessions", "2026", "09", "16", "rollout-2026-09-16T07-32-17-01a0a8b3-9870-7e22-86c3-19657c54a224.jsonl");
    const deps = fakeDeps(
      { "2026/09/16": ["rollout-2026-09-16T07-32-17-01a0a8b3-9870-7e22-86c3-19657c54a224.jsonl"] },
      { [file]: sessionMetaLine("01a0a8b3-9870-7e22-86c3-19657c54a224", "C:\\Users\\sven\\Proj\\") },
    );
    const result = await discoverCodexThreadId(
      { cwd: "c:/Users/sven/Proj", sinceIso: "2026-09-16T05:00:00.000Z" },
      deps,
    );
    expect(result).toBe("01a0a8b3-9870-7e22-86c3-19657c54a224");
  });

  it("ignores a rollout file whose filename timestamp predates sinceIso", async () => {
    const file = path.join("/home/u", ".codex", "sessions", "2026", "09", "16", "rollout-2026-09-16T07-32-17-01a0a8b3-9870-7e22-86c3-19657c54a224.jsonl");
    const deps = fakeDeps(
      { "2026/09/16": ["rollout-2026-09-16T07-32-17-01a0a8b3-9870-7e22-86c3-19657c54a224.jsonl"] },
      { [file]: sessionMetaLine("01a0a8b3-9870-7e22-86c3-19657c54a224", "/tmp/proj") },
    );
    const result = await discoverCodexThreadId(
      { cwd: "/tmp/proj", sinceIso: "2026-09-16T10:00:00.000Z" },
      deps,
    );
    expect(result).toBeNull();
  });

  it("skips an excluded thread id even when cwd and timing match", async () => {
    const file = path.join("/home/u", ".codex", "sessions", "2026", "09", "16", "rollout-2026-09-16T07-32-17-01a0a8b3-9870-7e22-86c3-19657c54a224.jsonl");
    const deps = fakeDeps(
      { "2026/09/16": ["rollout-2026-09-16T07-32-17-01a0a8b3-9870-7e22-86c3-19657c54a224.jsonl"] },
      { [file]: sessionMetaLine("01a0a8b3-9870-7e22-86c3-19657c54a224", "/tmp/proj") },
    );
    const result = await discoverCodexThreadId(
      {
        cwd: "/tmp/proj",
        sinceIso: "2026-09-16T05:00:00.000Z",
        excludeThreadIds: new Set(["01a0a8b3-9870-7e22-86c3-19657c54a224"]),
      },
      deps,
    );
    expect(result).toBeNull();
  });

  it("ignores a non-rollout filename and a malformed first line without throwing", async () => {
    const goodFile = path.join("/home/u", ".codex", "sessions", "2026", "09", "16", "rollout-2026-09-16T07-32-17-01a0a8b3-9870-7e22-86c3-19657c54a224.jsonl");
    const deps = fakeDeps(
      {
        "2026/09/16": [
          "not-a-rollout-file.txt",
          "rollout-2026-09-16T07-30-00-bad-thread-id-not-uuid.jsonl",
          "rollout-2026-09-16T07-32-17-01a0a8b3-9870-7e22-86c3-19657c54a224.jsonl",
        ],
      },
      { [goodFile]: sessionMetaLine("01a0a8b3-9870-7e22-86c3-19657c54a224", "/tmp/proj") },
    );
    const result = await discoverCodexThreadId(
      { cwd: "/tmp/proj", sinceIso: "2026-09-16T05:00:00.000Z" },
      deps,
    );
    expect(result).toBe("01a0a8b3-9870-7e22-86c3-19657c54a224");
  });

  it("returns null when no day folder exists at all (ENOENT on every candidate)", async () => {
    const deps = fakeDeps({}, {});
    const result = await discoverCodexThreadId(
      { cwd: "/tmp/proj", sinceIso: "2026-09-16T05:00:00.000Z" },
      deps,
    );
    expect(result).toBeNull();
  });

  it("returns null for a malformed sinceIso rather than throwing", async () => {
    const deps = fakeDeps({}, {});
    const result = await discoverCodexThreadId(
      { cwd: "/tmp/proj", sinceIso: "not-a-date" },
      deps,
    );
    expect(result).toBeNull();
  });
});
