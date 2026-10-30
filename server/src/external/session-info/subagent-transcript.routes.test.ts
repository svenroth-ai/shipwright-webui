import { afterEach, describe, expect, it } from "vitest";
import { appendFileSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

import { createSessionInfoRouter } from "./routes.js";
import { SessionWatcher } from "../../core/session-watcher.js";
import { readSubagentTranscript } from "../../core/session-info/subagent-transcript.js";
import { SESSION, assistant, jl, makeLayout, writeAgent, type Layout } from "../../core/session-info/test-fixtures.js";

let l: Layout;
afterEach(() => l && rmSync(l.projectsDir, { recursive: true, force: true }));

const store = (uuid: string) => ({ get: (id: string) => (id === "t1" ? { taskId: "t1", sessionUuid: uuid } : undefined) }) as never;
const mk = () => createSessionInfoRouter({ store: store(SESSION), watcher: new SessionWatcher({ projectsDir: l.projectsDir }) });
const url = (id: string) => `/api/external/tasks/t1/subagents/${id}/transcript`;

describe("GET /api/external/tasks/:id/subagents/:agentId/transcript", () => {
  // @covers FR-01.66
  it("404 for an unknown task", async () => {
    l = makeLayout();
    expect((await mk().request("/api/external/tasks/nope/subagents/a1/transcript")).status).toBe(404);
  });

  // @covers FR-01.66
  it("400 for a malformed agent id (traversal attempt)", async () => {
    l = makeLayout();
    writeFileSync(l.sessionPath, jl(assistant(1)));
    expect((await mk().request(url("..%2F..%2Fx"))).status).toBe(400);
    expect((await mk().request(url("a.b"))).status).toBe(400);
  });

  // @covers FR-01.66
  it("returns the agent file content, read-only", async () => {
    l = makeLayout();
    writeFileSync(l.sessionPath, jl(assistant(1)));
    const p = writeAgent(l, "abc123", {}, [assistant(2, { sidechain: true }), assistant(3, { sidechain: true })]);
    const before = (await import("node:fs")).readFileSync(p);
    const body = (await (await mk().request(url("abc123"))).json()) as { status: string; content: string; truncated: boolean };
    expect(body.status).toBe("ok");
    expect(body.truncated).toBe(false);
    expect(body.content.trim().split("\n")).toHaveLength(2);
    expect((await import("node:fs")).readFileSync(p).equals(before)).toBe(true);
  });

  // @covers FR-01.66
  it("missing for an agent that has no file", async () => {
    l = makeLayout();
    writeFileSync(l.sessionPath, jl(assistant(1)));
    expect(await (await mk().request(url("nope1"))).json()).toEqual({ status: "missing" });
  });
});

describe("readSubagentTranscript", () => {
  // @covers FR-01.66
  it("tails a big file on a line boundary, flags truncation, drops a half-written last line", async () => {
    l = makeLayout();
    writeFileSync(l.sessionPath, jl(assistant(1)));
    const lines = Array.from({ length: 200 }, (_, i) => assistant(i % 50, { blocks: [{ type: "text", text: `line-${i} ${"x".repeat(100)}` }] }));
    const p = writeAgent(l, "big", {}, lines);
    appendFileSync(p, '{"type":"assistant","half'); // torn tail
    const r = await readSubagentTranscript(l.sessionPath, "big", 4000);
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.truncated).toBe(true);
    const out = r.content.trim().split("\n");
    expect(out.length).toBeGreaterThan(1);
    for (const ln of out) expect(() => JSON.parse(ln)).not.toThrow();
    expect(out[out.length - 1]).toContain("line-199");
  });

  // @covers FR-01.66
  it("refuses a symlink that escapes the agent's own file slot", async () => {
    l = makeLayout();
    writeFileSync(l.sessionPath, jl(assistant(1)));
    const secret = path.join(l.projectsDir, "secret.jsonl");
    writeFileSync(secret, jl(assistant(9)));
    try {
      symlinkSync(secret, path.join(l.subDir, "agent-evil.jsonl"));
    } catch {
      return; // symlinks need privileges on Windows; the guard is exercised on CI (Linux)
    }
    expect(await readSubagentTranscript(l.sessionPath, "evil")).toEqual({ status: "missing" });
  });

  // @covers FR-01.66
  it("refuses a directory named like an agent file", async () => {
    l = makeLayout();
    writeFileSync(l.sessionPath, jl(assistant(1)));
    mkdirSync(path.join(l.subDir, "agent-dir1.jsonl"));
    expect(await readSubagentTranscript(l.sessionPath, "dir1")).toEqual({ status: "missing" });
  });
});
