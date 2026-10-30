import { afterEach, describe, expect, it } from "vitest";
import { appendFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import path from "node:path";

import { readSessionInfo } from "./session-info.js";
import { scanLines } from "./line-scan.js";
import {
  SESSION, assistant, jl, makeLayout, notification, toolUse, ts, userNotif, writeAgent, type Layout,
} from "./test-fixtures.js";

let l: Layout;
afterEach(() => l && rmSync(l.projectsDir, { recursive: true, force: true }));

const loc = () => ({ path: l.sessionPath, encodedCwd: "C--proj-repo", mtimeMs: 0, sizeBytes: 0 });
const deps = { noMemo: true, sessionsDir: "Z:\\does-not-exist", now: () => Date.parse(ts(100)) };

describe("plain iterate session", () => {
  it("context = input+cache_read+cache_creation of the newest non-synthetic assistant message", async () => {
    l = makeLayout();
    writeFileSync(
      l.sessionPath,
      jl(
        assistant(1, { usage: [10, 100, 1000] }),
        assistant(2, { usage: [2, 50000, 20] }),
        assistant(3, { model: "<synthetic>", usage: [0, 0, 0] }),
        { type: "user", timestamp: ts(4), message: { role: "user", content: "hi" } },
      ),
    );
    const info = await readSessionInfo(SESSION, loc(), deps);
    expect(info.context).toMatchObject({ tokens: 50022, model: "claude-opus-4", compactedSince: false });
    expect(info.context).not.toHaveProperty("percent");
    expect(info.subagents).toEqual([]);
    expect(info.remoteControl).toEqual({ active: false, onceEnabled: false, pid: null });
  });

  it("outputs: Write/Edit/NotebookEdit, normalised against each entry's own cwd, newest first, deduped", async () => {
    l = makeLayout();
    writeFileSync(
      l.sessionPath,
      jl(
        assistant(1, { blocks: [toolUse("Write", { file_path: "C:/proj/repo/src/a.ts" })] }),
        assistant(2, { blocks: [toolUse("Edit", { file_path: "src\\b.ts" })] }), // relative -> cwd
        assistant(3, { cwd: "C:\\proj\\other", blocks: [toolUse("NotebookEdit", { notebook_path: "n.ipynb" })] }),
        assistant(4, { blocks: [toolUse("Edit", { file_path: "c:\\PROJ\\repo\\src\\a.ts" })] }), // same file, other case
        assistant(5, { blocks: [toolUse("Read", { file_path: "C:\\proj\\repo\\nope.ts" })] }), // not an output
      ),
    );
    const { outputs } = await readSessionInfo(SESSION, loc(), deps);
    expect(outputs.map((o) => o.path)).toEqual([
      "C:\\proj\\repo\\src\\a.ts",
      "C:\\proj\\other\\n.ipynb",
      "C:\\proj\\repo\\src\\b.ts",
    ]);
    expect(outputs[0]).toMatchObject({ tool: "Edit", firstAt: ts(1), lastAt: ts(4) });
  });

  it("posix cwd + relative path resolves posix", async () => {
    l = makeLayout();
    writeFileSync(l.sessionPath, jl(assistant(1, { cwd: "/home/u/p", blocks: [toolUse("Write", { file_path: "../q/x.md" })] })));
    const { outputs } = await readSessionInfo(SESSION, loc(), deps);
    expect(outputs[0]!.path).toBe("/home/u/q/x.md");
  });

  it("torn last line and unrelated records are tolerated", async () => {
    l = makeLayout();
    writeFileSync(l.sessionPath, jl(assistant(1, { usage: [1, 2, 3] }), { type: "mode", mode: "x" }) + '{"type":"assist');
    const info = await readSessionInfo(SESSION, loc(), deps);
    expect(info.context.tokens).toBe(6);
  });
});

describe("compaction", () => {
  const boundary = (n: number) => ({
    type: "system", subtype: "compact_boundary", timestamp: ts(n),
    compactMetadata: { trigger: "auto", preTokens: 367541, postTokens: 19789 },
  });

  it("compaction after the last usage => stale tokens replaced by postTokens estimate", async () => {
    l = makeLayout();
    writeFileSync(l.sessionPath, jl(assistant(1, { usage: [1, 300000, 5] }), boundary(2)));
    const info = await readSessionInfo(SESSION, loc(), deps);
    expect(info.context).toMatchObject({ tokens: 19789, compactedSince: true });
    expect(info.compaction).toEqual({ count: 1, last: { at: ts(2), preTokens: 367541, postTokens: 19789 } });
  });

  it("a fresh assistant message after compaction wins again", async () => {
    l = makeLayout();
    writeFileSync(l.sessionPath, jl(assistant(1, { usage: [1, 300000, 5] }), boundary(2), assistant(3, { usage: [1, 21000, 2] })));
    const info = await readSessionInfo(SESSION, loc(), deps);
    expect(info.context).toMatchObject({ tokens: 21003, compactedSince: false });
    expect(info.compaction.count).toBe(1);
  });
});

describe("remote control", () => {
  it("bridge-session in JSONL alone => onceEnabled, not active", async () => {
    l = makeLayout();
    writeFileSync(l.sessionPath, jl({ type: "bridge-session", sessionId: SESSION, bridgeSessionId: "cse_1" }, assistant(1)));
    const info = await readSessionInfo(SESSION, loc(), deps);
    expect(info.remoteControl).toEqual({ active: false, onceEnabled: true, pid: null });
  });

  it("live pid in ~/.claude/sessions with bridgeSessionId => active; dead pid => not", async () => {
    l = makeLayout();
    writeFileSync(l.sessionPath, jl(assistant(1)));
    const sessionsDir = path.join(l.projectsDir, "sessions");
    const { mkdirSync } = await import("node:fs");
    mkdirSync(sessionsDir);
    writeFileSync(path.join(sessionsDir, "4242.json"), JSON.stringify({ pid: 4242, sessionId: SESSION, bridgeSessionId: "session_x" }));
    writeFileSync(path.join(sessionsDir, "7.json"), JSON.stringify({ pid: 7, sessionId: "other", bridgeSessionId: "session_y" }));
    const on = await readSessionInfo(SESSION, loc(), { ...deps, sessionsDir, isPidAlive: (p) => p === 4242 });
    expect(on.remoteControl).toEqual({ active: true, onceEnabled: true, pid: 4242 });
    const dead = await readSessionInfo(SESSION, loc(), { ...deps, sessionsDir, isPidAlive: () => false });
    expect(dead.remoteControl).toEqual({ active: false, onceEnabled: true, pid: null });
  });
});

describe("campaign session with depth-2 subagents", () => {
  function build() {
    l = makeLayout();
    // Parent: spawns sub-iterate A1 (depth 1) and a still-running A2; notified only about A1.
    writeFileSync(
      l.sessionPath,
      jl(
        assistant(1, { usage: [5, 1000, 10], blocks: [toolUse("Agent", { description: "M2 runner", prompt: "Build M2 please" }, "toolu_A1")] }),
        assistant(2, { blocks: [toolUse("Agent", { description: "M3 runner", prompt: "Build M3" }, "toolu_A2")] }),
        userNotif(50, notification("aaa1", "toolu_A1", "completed", 42000)),
        { type: "queue-operation", operation: "enqueue", timestamp: ts(50), content: notification("aaa1", "toolu_A1", "completed", 42000) },
      ),
    );
    // A1 (depth 1) writes a file and spawns reviewer R1 (depth 2), which it is notified about.
    writeAgent(l, "aaa1", { agentType: "sub-iterate-runner", description: "M2 runner", toolUseId: "toolu_A1", spawnDepth: 1 }, [
      assistant(10, { sidechain: true, blocks: [toolUse("Write", { file_path: "C:\\proj\\repo\\server\\m2.ts" }), toolUse("Agent", { description: "review", prompt: "Review the diff" }, "toolu_R1")] }),
      userNotif(30, notification("rrr1", "toolu_R1", "failed", 9000)),
      assistant(40, { sidechain: true, blocks: [{ type: "text", text: "Done: PR open." }] }),
    ]);
    writeAgent(l, "rrr1", { agentType: "code-reviewer", description: "review", toolUseId: "toolu_R1", spawnDepth: 2, parentAgentId: "aaa1" }, [
      assistant(20, { sidechain: true, blocks: [toolUse("Edit", { file_path: "C:\\proj\\repo\\notes.md" })] }),
      assistant(29, { sidechain: true, blocks: [{ type: "text", text: "Found 2 issues." }] }),
    ]);
    writeAgent(l, "aaa2", { agentType: "sub-iterate-runner", toolUseId: "toolu_A2", spawnDepth: 1 }, [
      assistant(60, { sidechain: true, blocks: [{ type: "text", text: "working" }] }),
    ]);
  }

  it("joins meta + notification + prompt; depth-2 finished via the depth-1 file's notification", async () => {
    build();
    const info = await readSessionInfo(SESSION, loc(), { ...deps, now: () => Date.now() });
    const by = Object.fromEntries(info.subagents.map((s) => [s.agentId, s]));
    expect(Object.keys(by).sort()).toEqual(["aaa1", "aaa2", "rrr1"]);
    expect(by.aaa1).toMatchObject({
      agentType: "sub-iterate-runner", spawnDepth: 1, parentAgentId: null, state: "finished", status: "completed",
      durationMs: 42000, prompt: "Build M2 please", answer: "Done: PR open.", startedAt: ts(10), endedAt: ts(40), tokens: 1234, toolUses: 7,
    });
    expect(by.rrr1).toMatchObject({
      spawnDepth: 2, parentAgentId: "aaa1", state: "finished", status: "failed", prompt: "Review the diff", answer: "Found 2 issues.", durationMs: 9000,
    });
    expect(by.aaa2).toMatchObject({ state: "running", status: null, endedAt: null, prompt: "Build M3", description: "M3 runner" });
  });

  it("no notification + stale mtime => finished-stale", async () => {
    build();
    const p = path.join(l.subDir, "agent-aaa2.jsonl");
    const old = new Date(Date.now() - 3600_000);
    utimesSync(p, old, old);
    const info = await readSessionInfo(SESSION, loc(), { ...deps, now: () => Date.now() });
    expect(info.subagents.find((s) => s.agentId === "aaa2")).toMatchObject({ state: "finished-stale", status: null, endedAt: ts(60) });
  });

  it("outputs include subagent writes, attributed to the agent, merged newest-first", async () => {
    build();
    const { outputs } = await readSessionInfo(SESSION, loc(), deps);
    expect(outputs.map((o) => [o.path, o.agentId])).toEqual([
      ["C:\\proj\\repo\\notes.md", "rrr1"],
      ["C:\\proj\\repo\\server\\m2.ts", "aaa1"],
    ]);
  });

  it("ignores non-agent files and symlink-shaped names in subagents/", async () => {
    build();
    writeFileSync(path.join(l.subDir, "agent-..evil.jsonl"), "{}\n");
    writeFileSync(path.join(l.subDir, "notes.txt"), "x");
    const info = await readSessionInfo(SESSION, loc(), deps);
    expect(info.subagents).toHaveLength(3);
  });
});

describe("large files", () => {
  it("scans only the newest window of a file bigger than the cap; flags truncated; keeps UTF-8 intact", async () => {
    l = makeLayout();
    const filler = jl({ type: "user", timestamp: ts(1), message: { role: "user", content: "ä".repeat(200) } });
    writeFileSync(l.sessionPath, filler.repeat(300)); // ~120 KB
    appendFileSync(l.sessionPath, jl(assistant(5, { usage: [1, 2, 3], blocks: [toolUse("Write", { file_path: "C:\\proj\\repo\\ü.ts" })] })));
    const seen: string[] = [];
    const r = await scanLines(l.sessionPath, 30_000, (line) => seen.push(line));
    expect(r.truncated).toBe(true);
    expect(r.scannedBytes).toBe(30_000);
    expect(seen.every((x) => x.startsWith("{") && x.endsWith("}"))).toBe(true); // partial first line dropped
    expect(seen.at(-1)).toContain("ü.ts");
    expect(statSync(l.sessionPath).size).toBe(r.sizeBytes);
  });
});
