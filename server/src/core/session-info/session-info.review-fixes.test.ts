import { afterEach, describe, expect, it } from "vitest";
import { appendFileSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { readSessionInfo, scanStats } from "./session-info.js";
import { scanLines } from "./line-scan.js";
import { SESSION, assistant, jl, makeLayout, toolUse, ts, writeAgent, type Layout } from "./test-fixtures.js";

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

  it("an errored foreground agent is failed", async () => {
    l = makeLayout();
    writeFileSync(l.sessionPath, jl(assistant(1, { blocks: [toolUse("Agent", {}, "toolu_E")] }), toolResult(3, "toolu_E", { is_error: true })));
    writeAgent(l, "eee1", { toolUseId: "toolu_E" }, [assistant(2, { sidechain: true })]);
    expect((await readSessionInfo(SESSION, loc(), deps)).subagents[0]).toMatchObject({ state: "finished", status: "failed" });
  });

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

describe("compaction without postTokens", () => {
  it("reports null, not the stale pre-compaction number", async () => {
    l = makeLayout();
    writeFileSync(
      l.sessionPath,
      jl(assistant(1, { usage: [1, 300000, 5] }), { type: "system", subtype: "compact_boundary", timestamp: ts(2), compactMetadata: { trigger: "auto" } }),
    );
    const info = await readSessionInfo(SESSION, loc(), deps);
    expect(info.context).toMatchObject({ tokens: null, compactedSince: true });
  });
});

describe("timestamps", () => {
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
  it("multi-chunk carry with multi-byte chars split across tiny chunks", async () => {
    l = makeLayout();
    const lines = ["aä€😀b", "ü".repeat(40), "tail"].map((t) => JSON.stringify({ t }));
    writeFileSync(l.sessionPath, lines.join("\n") + "\n");
    const got: string[] = [];
    await scanLines(l.sessionPath, 1e6, (x) => got.push(x), { chunkBytes: 7 });
    expect(got).toEqual(lines);
  });

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

  it("an over-long record is skipped without losing its neighbours", async () => {
    l = makeLayout();
    writeFileSync(l.sessionPath, `{"a":1}\n${"x".repeat(5000)}\n{"c":3}\n`);
    const got: string[] = [];
    await scanLines(l.sessionPath, 1e6, (x) => got.push(x), { chunkBytes: 64, maxLineBytes: 1000 });
    expect(got).toEqual(['{"a":1}', '{"c":3}']);
  });

  it("a missing file fails fast (ENOENT is fatal, no retry budget)", async () => {
    const t = Date.now();
    await expect(scanLines("Z:\\nope\\x.jsonl", 10, () => {})).rejects.toMatchObject({ code: "ENOENT" });
    expect(Date.now() - t).toBeLessThan(500);
  });
});

describe("per-file memo", () => {
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
  it("session-info sources import no write APIs", () => {
    const dir = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".ts") && !x.includes("test"))) {
      const src = readFileSync(path.join(dir, f), "utf8");
      expect(src, f).not.toMatch(/\b(writeFile|appendFile|createWriteStream|unlink|rename|rm|mkdir|truncate|copyFile)(Sync)?\s*[(,}]/);
      expect(src, f).not.toMatch(/open\([^)]*["'](w|a|r\+)/);
    }
  });
});
