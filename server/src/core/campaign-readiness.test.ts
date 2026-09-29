import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  computeReadiness,
  getReadiness,
  resetReadinessCache,
  resolveLoopClaimScript,
  type ReadinessDeps,
} from "./campaign-readiness.js";

const runUv = async () => ({ ok: true, stdout: "uv 0.11.9", stderr: "" });
const noUv = async () => ({ ok: false, stdout: "", stderr: "" });
const SCRIPT = path.join(os.tmpdir(), "fake-cache", "loop_claim.py");

const REPORT = {
  schema_version: "1.0",
  loop_id: "L1",
  branch_strategy: "independent",
  base_branch: "main",
  supported: true,
  finalized: false,
  ready_ids: ["B"],
  units: [
    { id: "A", state: "merged", ready: false, blocked_by: [] },
    { id: "B", state: "pending", ready: true, blocked_by: [] },
  ],
};
const ok = (payload: unknown = REPORT) => ({ code: 0, stdout: JSON.stringify(payload), stderr: "" });

let root: string;
const stateFile = (dir: string) => path.join(dir, ".shipwright", "loop_state.json");
function writeState(dir: string, units: Array<Record<string, unknown>>): void {
  mkdirSync(path.join(dir, ".shipwright"), { recursive: true });
  writeFileSync(stateFile(dir), JSON.stringify({ kind: "sub_iterate", units }));
}
const unitFor = (slug: string) => ({ id: "A", status: "pending", spec_path: `x/campaigns/${slug}/sub-iterates/A-a.md` });

function deps(over: Partial<ReadinessDeps> & { calls?: string[][] } = {}): ReadinessDeps {
  const { calls, ...rest } = over;
  return {
    run: runUv,
    scriptOverride: SCRIPT,
    existsFn: (p) => p === SCRIPT || existsSync(p),
    spawn: async (_b, args) => {
      calls?.push(args);
      return ok();
    },
    ...rest,
  };
}

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "readiness-"));
  resetReadinessCache();
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("computeReadiness — where the state lives", () => {
  it("a campaign WITH its own worktree passes that worktree as BOTH the --state base and --campaign-worktree", async () => {
    const wt = path.join(root, ".worktrees", "campaign-demo");
    writeState(wt, [unitFor("demo")]);
    const calls: string[][] = [];
    const out = await computeReadiness({ projectRoot: root, slug: "demo" }, deps({ calls }));
    expect(out.status).toBe("report");
    const real = realpathSync(wt);
    expect(calls[0]).toEqual([
      "run", "--no-project", "--python", ">=3.11", SCRIPT, "readiness",
      "--state", stateFile(real), "--campaign-worktree", real, "--json",
    ]);
  });

  it("never reads the MAIN root's loop_state for a worktree campaign", async () => {
    writeState(root, [unitFor("demo")]); // main root has state…
    mkdirSync(path.join(root, ".worktrees", "campaign-demo"), { recursive: true }); // …its worktree has none
    const calls: string[][] = [];
    const out = await computeReadiness({ projectRoot: root, slug: "demo" }, deps({ calls }));
    expect(out).toEqual({ status: "no-loop" });
    expect(calls).toHaveLength(0);
  });

  it("falls back to the project root for a legacy campaign whose units are in that state", async () => {
    writeState(root, [unitFor("legacy")]);
    const calls: string[][] = [];
    const out = await computeReadiness({ projectRoot: root, slug: "legacy" }, deps({ calls }));
    expect(out.status).toBe("report");
    expect(calls[0]).toContain(stateFile(root));
    expect(calls[0][calls[0].indexOf("--campaign-worktree") + 1]).toBe(root);
  });

  it("a legacy root state holding ANOTHER campaign's units is 'no loop' for this one", async () => {
    writeState(root, [unitFor("other")]);
    expect(await computeReadiness({ projectRoot: root, slug: "legacy" }, deps())).toEqual({ status: "no-loop" });
  });

  it("a missing state file is 'no loop running', not an error", async () => {
    expect(await computeReadiness({ projectRoot: root, slug: "demo" }, deps())).toEqual({ status: "no-loop" });
  });
});

describe("computeReadiness — outcome mapping", () => {
  beforeEach(() => writeState(path.join(root, ".worktrees", "campaign-demo"), [unitFor("demo")]));
  const run = (d: ReadinessDeps) => computeReadiness({ projectRoot: root, slug: "demo" }, d);

  it("script missing → engine-unavailable", async () => {
    expect(await run(deps({ existsFn: (p) => p !== SCRIPT && existsSync(p) }))).toMatchObject({ status: "engine-unavailable" });
  });

  it("uv missing → engine-unavailable (never a bare-python fallback)", async () => {
    expect(await run(deps({ run: noUv }))).toMatchObject({ status: "engine-unavailable", reason: expect.stringContaining("uv") });
  });

  it("spawn failure (-1) → engine-unavailable", async () => {
    expect(await run(deps({ spawn: async () => ({ code: -1, stdout: "", stderr: "", spawnError: "ENOENT" }) }))).toMatchObject({ status: "engine-unavailable" });
  });

  it("'only valid for kind' (a section loop) → no-loop", async () => {
    const out = await run(deps({ spawn: async () => ({ code: 1, stdout: "", stderr: "ERROR: readiness is only valid for kind == 'sub_iterate'" }) }));
    expect(out).toEqual({ status: "no-loop" });
  });

  it("other non-zero exit → failed with the CLI's last stderr line", async () => {
    const out = await run(deps({ spawn: async () => ({ code: 1, stdout: "", stderr: 'noise\n{"error":"malformed_state"}\n' }) }));
    expect(out).toEqual({ status: "failed", reason: '{"error":"malformed_state"}' });
  });

  it("timeout → a plain-language failed reason", async () => {
    const out = await run(deps({ spawn: async () => ({ code: 124, stdout: "", stderr: "", spawnError: "timeout" }) }));
    expect(out).toMatchObject({ status: "failed", reason: expect.stringContaining("too long") });
  });

  it("non-JSON stdout → failed", async () => {
    expect(await run(deps({ spawn: async () => ({ code: 0, stdout: "not json", stderr: "" }) }))).toMatchObject({ status: "failed" });
  });

  it("a different MAJOR → unsupported-version, never guessed at", async () => {
    const out = await run(deps({ spawn: async () => ok({ ...REPORT, schema_version: "2.0" }) }));
    expect(out).toEqual({ status: "unsupported-version", version: "2.0" });
  });

  it("an additive MINOR still parses", async () => {
    const out = await run(deps({ spawn: async () => ok({ ...REPORT, schema_version: "1.3", extra: 1 }) }));
    expect(out.status).toBe("report");
  });

  it("wrong shape at the supported major → failed (unrecognised)", async () => {
    const out = await run(deps({ spawn: async () => ok({ ...REPORT, units: "x" }) }));
    expect(out).toMatchObject({ status: "failed", reason: expect.stringContaining("unrecognised") });
  });
});

describe("resolveLoopClaimScript", () => {
  it("looks under <cache>/shared/scripts/lib/loop_claim.py", () => {
    const seen: string[] = [];
    resolveLoopClaimScript({ homeDir: "/home/u", existsFn: (p) => (seen.push(p), true) });
    expect(seen[0].replace(/\\/g, "/")).toBe("/home/u/.claude/plugins/cache/shipwright/shared/scripts/lib/loop_claim.py");
  });
  it("SHIPWRIGHT_LOOP_CLAIM_SCRIPT overrides the cache location", () => {
    const prev = process.env.SHIPWRIGHT_LOOP_CLAIM_SCRIPT;
    process.env.SHIPWRIGHT_LOOP_CLAIM_SCRIPT = "/elsewhere/loop_claim.py";
    try {
      expect(resolveLoopClaimScript({ homeDir: "/home/u", existsFn: (p) => p === "/elsewhere/loop_claim.py" })).toBe("/elsewhere/loop_claim.py");
    } finally {
      if (prev === undefined) delete process.env.SHIPWRIGHT_LOOP_CLAIM_SCRIPT;
      else process.env.SHIPWRIGHT_LOOP_CLAIM_SCRIPT = prev;
    }
  });
  it("null when absent", () => {
    expect(resolveLoopClaimScript({ homeDir: "/home/u", existsFn: () => false })).toBeNull();
  });
});

describe("getReadiness — cache + coalescing + bounded wait", () => {
  beforeEach(() => writeState(path.join(root, ".worktrees", "campaign-demo"), [unitFor("demo")]));
  const input = () => ({ projectRoot: root, slug: "demo" });

  it("concurrent callers share ONE spawn", async () => {
    let spawns = 0;
    const d = deps({ spawn: async () => (spawns++, ok()) });
    await Promise.all([getReadiness(input(), d), getReadiness(input(), d), getReadiness(input(), d)]);
    expect(spawns).toBe(1);
  });

  it("serves a fresh result from cache, recomputes once it is older than maxAgeMs", async () => {
    let spawns = 0;
    let t = 1_000;
    const d = deps({ now: () => t, spawn: async () => (spawns++, ok()) });
    await getReadiness(input(), d);
    t += 10_000;
    await getReadiness(input(), d);
    expect(spawns).toBe(1);
    t += 6_000; // 16 s since the compute > the 15 s default
    await getReadiness(input(), d);
    expect(spawns).toBe(2);
  });

  it("maxAgeMs:0 ALWAYS recomputes, even within the same millisecond", async () => {
    let spawns = 0;
    const d = deps({ now: () => 1_000, spawn: async () => (spawns++, ok()) });
    await getReadiness(input(), d);
    await getReadiness(input(), d, { maxAgeMs: 0 });
    expect(spawns).toBe(2);
  });

  it("an error outcome is retried after 5 s, not held for the full TTL", async () => {
    let spawns = 0;
    let t = 1_000;
    const d = deps({ now: () => t, spawn: async () => (spawns++, { code: 1, stdout: "", stderr: "boom" }) });
    await getReadiness(input(), d);
    t += 6_000;
    await getReadiness(input(), d);
    expect(spawns).toBe(2);
  });

  it("maxWaitMs elapsing returns 'timeout' while the call still completes into the cache", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let spawns = 0;
    const d = deps({ spawn: async () => (spawns++, await gate, ok()) });
    expect(await getReadiness(input(), d, { maxWaitMs: 20 })).toBe("timeout");
    release();
    expect(await getReadiness(input(), d)).toMatchObject({ status: "report" }); // joins the in-flight call
    expect(spawns).toBe(1);
  });
});
