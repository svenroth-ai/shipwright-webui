import { afterEach, describe, expect, it } from "vitest";
import { rmSync, utimesSync, writeFileSync } from "node:fs";

import { readSessionInfo } from "./session-info.js";
import { SESSION, assistant, jl, makeLayout, notification, toolUse, ts, userNotif, writeAgent, type Layout } from "./test-fixtures.js";

let l: Layout;
afterEach(() => l && rmSync(l.projectsDir, { recursive: true, force: true }));

const loc = () => ({ path: l.sessionPath, encodedCwd: "C--proj-repo", mtimeMs: 0, sizeBytes: 0 });
const deps = { noMemo: true, sessionsDir: "Z:\does-not-exist", now: () => Date.now() };

/** Agent notified at ts(50) but its file keeps a line at ts(60): the "resumed" shape. */
function build(): string {
  l = makeLayout();
  writeFileSync(
    l.sessionPath,
    jl(
      assistant(1, { blocks: [toolUse("Agent", { description: "Run sub-iterate V2", prompt: "go" }, "toolu_V2")] }),
      userNotif(50, notification("vvv2", "toolu_V2", "completed", 42000)),
    ),
  );
  return writeAgent(l, "vvv2", { agentType: "sub-iterate-runner", toolUseId: "toolu_V2", spawnDepth: 1 }, [
    assistant(10, { sidechain: true }),
    assistant(60, { sidechain: true, blocks: [{ type: "text", text: "late note" }] }),
  ]);
}

describe("resumed subagent staleness", () => {
  // @covers FR-01.66
  it("resumed + file quiet for hours => finished-stale, NOT running", async () => {
    const p = build();
    const old = new Date(Date.now() - 24 * 3600_000);
    utimesSync(p, old, old);
    const info = await readSessionInfo(SESSION, loc(), deps);
    expect(info.subagents[0]).toMatchObject({ state: "finished-stale", status: "completed", tokens: 1234 });
    expect(info.subagents[0]!.endedAt).not.toBeNull();
  });

  // @covers FR-01.66
  it("resumed + file still being written => stays running", async () => {
    build();
    const info = await readSessionInfo(SESSION, loc(), deps);
    expect(info.subagents[0]).toMatchObject({ state: "running", status: null, endedAt: null });
  });

  // @covers FR-01.66
  it("not resumed (no write after the notice) => finished regardless of mtime", async () => {
    const p = build();
    writeFileSync(p, jl(assistant(10, { sidechain: true }), assistant(51, { sidechain: true })));
    const old = new Date(Date.now() - 24 * 3600_000);
    utimesSync(p, old, old);
    const info = await readSessionInfo(SESSION, loc(), deps);
    expect(info.subagents[0]).toMatchObject({ state: "finished", status: "completed" });
  });
});
