import { afterEach, describe, expect, it } from "vitest";
import { appendFileSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

import { readSessionInfo, scanStats } from "./session-info.js";
import { scanLines } from "./line-scan.js";
import { SESSION, assistant, jl, makeLayout, notification, toolUse, ts, writeAgent, type Layout } from "./test-fixtures.js";

let l: Layout;
afterEach(() => l && rmSync(l.projectsDir, { recursive: true, force: true }));
const loc = () => ({ path: l.sessionPath, encodedCwd: "x", mtimeMs: 0, sizeBytes: 0 });
const deps = { sessionsDir: "Z:\\none", now: () => Date.parse(ts(100)), noMemo: true };

const toolResult = (n: number, id: string, extra: { is_error?: boolean; tur?: Record<string, unknown> } = {}) => ({
  type: "user",
  timestamp: ts(n),
  message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, is_error: extra.is_error, content: "x" }] },
  toolUseResult: extra.tur,
});

describe("foreground subagents + failed writes", () => {
  // @covers FR-01.66
  it("a foreground agent (tool_result, no task-notification) is finished with the toolUseResult numbers", async () => {
    l = makeLayout();
    writeFileSync(
      l.sessionPath,
      jl(
        assistant(1, { blocks: [toolUse("Agent", { description: "rev", prompt: "p" }, "toolu_F")] }),
        toolResult(9, "toolu_F", { tur: { status: "completed", totalDurationMs: 8000, totalTokens: 500, totalToolUseCount: 3 } }),
      ),
    );
    writeAgent(l, "fff1", { agentType: "code-reviewer", toolUseId: "toolu_F", spawnDepth: 1 }, [assistant(2, { sidechain: true })]);
    const s = (await readSessionInfo(SESSION, loc(), deps)).subagents[0]!;
    expect(s).toMatchObject({ state: "finished", status: "completed", durationMs: 8000, tokens: 500, toolUses: 3 });
  });

  // @covers FR-01.66
  it("an errored foreground agent is failed", async () => {
    l = makeLayout();
    writeFileSync(l.sessionPath, jl(assistant(1, { blocks: [toolUse("Agent", {}, "toolu_E")] }), toolResult(3, "toolu_E", { is_error: true })));
    writeAgent(l, "eee1", { toolUseId: "toolu_E" }, [assistant(2, { sidechain: true })]);
    expect((await readSessionInfo(SESSION, loc(), deps)).subagents[0]).toMatchObject({ state: "finished", status: "failed" });
  });

  // @covers FR-01.66
  it("a rejected write is retracted from outputs; a successful one stays", async () => {
    l = makeLayout();
    writeFileSync(
      l.sessionPath,
      jl(
        assistant(1, {
          blocks: [
            toolUse("Write", { file_path: "C:\\proj\\repo\\bad.ts" }, "t_bad"),
            toolUse("Write", { file_path: "C:\\proj\\repo\\ok.ts" }, "t_ok"),
          ],
        }),
        toolResult(2, "t_bad", { is_error: true }),
      ),
    );
    const { outputs } = await readSessionInfo(SESSION, loc(), deps);
    expect(outputs.map((o) => o.path)).toEqual(["C:\\proj\\repo\\ok.ts"]);
  });
});

describe("review round 1 fixes", () => {
  // @covers FR-01.66
  it("a background launch ack (async_launched) is NOT completion: agent stays running", async () => {
    l = makeLayout();
    writeFileSync(
      l.sessionPath,
      jl(
        assistant(1, { blocks: [toolUse("Agent", { description: "bg", prompt: "p" }, "toolu_B")] }),
        toolResult(2, "toolu_B", { tur: { isAsync: true, status: "async_launched", agentId: "bbb1" } }),
      ),
    );
    writeAgent(l, "bbb1", { toolUseId: "toolu_B", spawnDepth: 1 }, [assistant(3, { sidechain: true })]);
    const s = (await readSessionInfo(SESSION, loc(), { ...deps, now: () => Date.now() })).subagents[0]!;
    expect(s).toMatchObject({ state: "running", status: null, endedAt: null });
  });

  // @covers FR-01.66
  it("failed Edit after a successful Write keeps the Write's lastAt/tool; failed first attempt fixes firstAt", async () => {
    l = makeLayout();
    const p = ["C:", "proj", "repo", "x.ts"].join(String.fromCharCode(92));
    writeFileSync(
      l.sessionPath,
      jl(
        assistant(1, { blocks: [toolUse("Edit", { file_path: p }, "e1")] }),
        toolResult(2, "e1", { is_error: true }),
        assistant(3, { blocks: [toolUse("Write", { file_path: p }, "w1")] }),
        assistant(4, { blocks: [toolUse("Edit", { file_path: p }, "e2")] }),
        toolResult(5, "e2", { is_error: true }),
      ),
    );
    const { outputs } = await readSessionInfo(SESSION, loc(), deps);
    expect(outputs).toHaveLength(1);
    expect(outputs[0]).toMatchObject({ tool: "Write", firstAt: ts(3), lastAt: ts(3) });
  });

  // @covers FR-01.66
  it("a symlinked meta file is not followed (skipped when the OS forbids symlinks)", async () => {
    l = makeLayout();
    writeFileSync(l.sessionPath, jl(assistant(1)));
    writeAgent(l, "sss1", { description: "real" }, [assistant(2, { sidechain: true })]);
    const outside = path.join(l.projectsDir, "outside.json");
    writeFileSync(outside, JSON.stringify({ description: "LEAKED" }));
    const metaPath = path.join(l.subDir, "agent-sss1.meta.json");
    rmSync(metaPath);
    try {
      symlinkSync(outside, metaPath);
    } catch {
      return; // no symlink privilege on this machine
    }
    const s = (await readSessionInfo(SESSION, loc(), deps)).subagents[0]!;
    expect(s.description).not.toBe("LEAKED");
  });
});

describe("background agents", () => {
  // @covers FR-01.66
  it("run_in_background: any tool_result (even with two acks in one line) never marks it finished", async () => {
    l = makeLayout();
    writeFileSync(
      l.sessionPath,
      jl(
        assistant(1, { blocks: [toolUse("Agent", { prompt: "a", run_in_background: true }, "toolu_1"), toolUse("Agent", { prompt: "b", run_in_background: true }, "toolu_2")] }),
        { type: "user", timestamp: ts(2), message: { role: "user", content: [
          { type: "tool_result", tool_use_id: "toolu_1", content: "ok" },
          { type: "tool_result", tool_use_id: "toolu_2", content: "ok" },
        ] } },
      ),
    );
    writeAgent(l, "bg1", { toolUseId: "toolu_1" }, [assistant(3, { sidechain: true })]);
    writeAgent(l, "bg2", { toolUseId: "toolu_2" }, [assistant(3, { sidechain: true })]);
    const subs = (await readSessionInfo(SESSION, loc(), { ...deps, now: () => Date.now() })).subagents;
    expect(subs.map((s) => s.state)).toEqual(["running", "running"]);
  });
});

describe("doubt-review fixes", () => {
  // @covers FR-01.66
  it("a transient EBUSY mid-scan does not double-count (facts reset per attempt)", async () => {
    l = makeLayout();
    const b = JSON.stringify({ type: "system", subtype: "compact_boundary", timestamp: ts(1), compactMetadata: { postTokens: 5 } });
    writeFileSync(l.sessionPath, `${b}
${b}
`);
    const real = await import("node:fs/promises");
    let first = true;
    const facts: string[] = [];
    await scanLines(l.sessionPath, 1e6, (x) => facts.push(x), {
      chunkBytes: 40,
      onAttempt: () => {
        facts.length = 0;
      },
      openForRead: async (p) => {
        const fh = await real.open(p, "r");
        let reads = 0;
        return {
          stat: () => fh.stat(),
          close: () => fh.close(),
          read: async (buf, off, len, pos) => {
            if (first && ++reads === 3) {
              first = false;
              throw Object.assign(new Error("busy"), { code: "EBUSY" });
            }
            return fh.read(buf, off, len, pos);
          },
        };
      },
    });
    expect(facts).toEqual([b, b]);
  });

  // @covers FR-01.66
  it("a resumed agent (writes after its notification) is running again", async () => {
    l = makeLayout();
    writeFileSync(l.sessionPath, jl(assistant(1, { blocks: [toolUse("Agent", {}, "toolu_R")] }), { type: "queue-operation", operation: "enqueue", timestamp: ts(10), content: notification("rrr9", "toolu_R", "completed") }));
    writeAgent(l, "rrr9", { toolUseId: "toolu_R" }, [assistant(5, { sidechain: true }), assistant(60, { sidechain: true })]);
    const s = (await readSessionInfo(SESSION, loc(), deps)).subagents[0]!;
    expect(s).toMatchObject({ state: "running", status: null, endedAt: null, durationMs: null });
  });

  // @covers FR-01.66
  it("an unanswered tool call keeps a silent agent running past the normal stale threshold", async () => {
    l = makeLayout();
    writeFileSync(l.sessionPath, jl(assistant(1)));
    const p = writeAgent(l, "ppp1", {}, [assistant(2, { sidechain: true, blocks: [toolUse("Bash", { command: "npm test" }, "toolu_slow")] })]);
    const old = new Date(Date.now() - 30 * 60 * 1000);
    (await import("node:fs")).utimesSync(p, old, old);
    expect((await readSessionInfo(SESSION, loc(), { ...deps, now: () => Date.now() })).subagents[0]!.state).toBe("running");
  });
});

describe("compaction without postTokens", () => {
  // @covers FR-01.66
  it("flags stale and reports no estimate (null), never invents one", async () => {
    l = makeLayout();
    writeFileSync(
      l.sessionPath,
      jl(assistant(1, { usage: [1, 300000, 5] }), { type: "system", subtype: "compact_boundary", timestamp: ts(2), compactMetadata: { trigger: "auto" } }),
    );
    const info = await readSessionInfo(SESSION, loc(), deps);
    expect(info.context).toMatchObject({ tokens: 300006, compactedSince: true, tokensAfterCompaction: null });
  });
});

describe("timestamps", () => {
  // @covers FR-01.66
  it("uses the record's own (last) timestamp, not one nested inside the message", async () => {
    l = makeLayout();
    const line = JSON.stringify({
      type: "user",
      message: { role: "user", content: "x", meta: { timestamp: "1999-01-01T00:00:00.000Z" } },
      timestamp: ts(5),
    });
    writeAgent(l, "ttt1", {}, [{ type: "x" }]);
    writeFileSync(path.join(l.subDir, "agent-ttt1.jsonl"), line + "\n" + line + "\n");
    writeFileSync(l.sessionPath, jl(assistant(1)));
    const s = (await readSessionInfo(SESSION, loc(), deps)).subagents[0]!;
    expect(s.startedAt).toBe(ts(5));
  });
});

describe("line scan edge cases", () => {
  // @covers FR-01.66
  it("multi-chunk carry with multi-byte chars split across tiny chunks", async () => {
    l = makeLayout();
    const lines = ["aä€😀b", "ü".repeat(40), "tail"].map((t) => JSON.stringify({ t }));
    writeFileSync(l.sessionPath, lines.join("\n") + "\n");
    const got: string[] = [];
    await scanLines(l.sessionPath, 1e6, (x) => got.push(x), { chunkBytes: 7 });
    expect(got).toEqual(lines);
  });

  // @covers FR-01.66
  it("window starting exactly on a line boundary keeps that line; mid-line drops the partial one", async () => {
    l = makeLayout();
    const a = JSON.stringify({ a: 1 });
    const b = JSON.stringify({ b: 2 });
    writeFileSync(l.sessionPath, `${a}\n${b}\n`);
    const got1: string[] = [];
    await scanLines(l.sessionPath, b.length + 1, (x) => got1.push(x));
    expect(got1).toEqual([b]);
    const got2: string[] = [];
    await scanLines(l.sessionPath, b.length + 3, (x) => got2.push(x));
    expect(got2).toEqual([b]);
  });

  // @covers FR-01.66
  it("an over-long record is skipped without losing its neighbours", async () => {
    l = makeLayout();
    writeFileSync(l.sessionPath, `{"a":1}\n${"x".repeat(5000)}\n{"c":3}\n`);
    const got: string[] = [];
    await scanLines(l.sessionPath, 1e6, (x) => got.push(x), { chunkBytes: 64, maxLineBytes: 1000 });
    expect(got).toEqual(['{"a":1}', '{"c":3}']);
  });

  // @covers FR-01.66
  it("a missing file fails fast (ENOENT is fatal, no retry budget)", async () => {
    const t = Date.now();
    await expect(scanLines("Z:\\nope\\x.jsonl", 10, () => {})).rejects.toMatchObject({ code: "ENOENT" });
    expect(Date.now() - t).toBeLessThan(500);
  });
});

describe("per-file memo", () => {
  // @covers FR-01.66
  it("one changed agent file triggers exactly one rescan; parallel polls share one scan", async () => {
    l = makeLayout();
    writeFileSync(l.sessionPath, jl(assistant(1, { usage: [1, 1, 1] })));
    writeAgent(l, "mmm1", { toolUseId: "t1" }, [assistant(2, { sidechain: true })]);
    writeAgent(l, "mmm2", { toolUseId: "t2" }, [assistant(3, { sidechain: true })]);
    const d = { sessionsDir: "Z:\\none" };
    scanStats.scans = 0;
    await Promise.all([readSessionInfo(SESSION, loc(), d), readSessionInfo(SESSION, loc(), d)]);
    expect(scanStats.scans).toBe(3);
    appendFileSync(path.join(l.subDir, "agent-mmm2.jsonl"), jl(assistant(9, { sidechain: true })));
    scanStats.scans = 0;
    await readSessionInfo(SESSION, loc(), d);
    expect(scanStats.scans).toBe(1);
  });
});

describe("read-only guard", () => {
  // @covers FR-01.66
  it("session-info sources import no write APIs", () => {
    const dir = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".ts") && !x.includes("test"))) {
      const src = readFileSync(path.join(dir, f), "utf8");
      expect(src, f).not.toMatch(/\b(writeFile|appendFile|createWriteStream|unlink|rename|rm|mkdir|truncate|copyFile)(Sync)?\s*[(,}]/);
      expect(src, f).not.toMatch(/open\([^)]*["'](w|a|r\+)/);
    }
  });
});
