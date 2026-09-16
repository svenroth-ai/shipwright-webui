import { describe, expect, it } from "vitest";

import { runCodexOracle } from "./codex-oracle-runner.js";

const runUv = async () => ({ ok: true, stdout: "uv 0.11.9", stderr: "" });
const noUv = async () => ({ ok: false, stdout: "", stderr: "" });
const exists = () => true;

describe("codex completion oracle CLI bridge", () => {
  it("runs via `uv run --no-project --python`, fixed argv, parses the verdict", async () => {
    const calls: string[][] = [];
    const bins: string[] = [];
    const result = await runCodexOracle(
      { projectRoot: "C:/project", phase: "build", session: "sess-1" },
      {
        run: runUv,
        existsFn: exists,
        scriptOverride: "C:/cache/codex_completion_oracle.py",
        spawn: async (bin, args) => {
          bins.push(bin);
          calls.push(args);
          return {
            code: 0,
            stdout: JSON.stringify({
              verdict: "done",
              phase: "build",
              session: "sess-1",
              evidence: { check: "work_completed[source=build]" },
            }),
            stderr: "",
          };
        },
      },
    );
    expect(bins[0]).toBe("uv");
    expect(calls[0]).toEqual([
      "run", "--no-project", "--python", ">=3.11",
      "C:/cache/codex_completion_oracle.py",
      "--project-root", "C:/project",
      "--phase", "build",
      "--session", "sess-1",
    ]);
    expect(result).toEqual({
      kind: "ok",
      result: {
        verdict: "done",
        phase: "build",
        session: "sess-1",
        evidence: { check: "work_completed[source=build]" },
      },
    });
  });

  it("passes --since when given", async () => {
    const calls: string[][] = [];
    await runCodexOracle(
      { projectRoot: "C:/project", phase: "iterate", session: "sess-1", since: "2026-09-16T00:00:00Z" },
      {
        run: runUv,
        existsFn: exists,
        scriptOverride: "C:/cache/codex_completion_oracle.py",
        spawn: async (_bin, args) => {
          calls.push(args);
          return {
            code: 1,
            stdout: JSON.stringify({ verdict: "not_done", phase: "iterate", session: "sess-1", evidence: {} }),
            stderr: "",
          };
        },
      },
    );
    expect(calls[0]).toContain("--since");
    expect(calls[0]).toContain("2026-09-16T00:00:00Z");
  });

  it("parses JSON even on a non-zero exit code (the oracle always prints a verdict)", async () => {
    const result = await runCodexOracle(
      { projectRoot: "C:/project", phase: "iterate", session: "sess-1" },
      {
        run: runUv,
        existsFn: exists,
        scriptOverride: "C:/cache/codex_completion_oracle.py",
        spawn: async () => ({
          code: 2,
          stdout: JSON.stringify({
            verdict: "delivery_pending",
            phase: "iterate",
            session: "sess-1",
            evidence: { delivery_state: "error" },
          }),
          stderr: "",
        }),
      },
    );
    expect(result).toEqual({
      kind: "ok",
      result: {
        verdict: "delivery_pending",
        phase: "iterate",
        session: "sess-1",
        evidence: { delivery_state: "error" },
      },
    });
  });

  it("uv missing → engine-unavailable WITHOUT falling back to a bare python", async () => {
    const result = await runCodexOracle(
      { projectRoot: "C:/project", phase: "build", session: "sess-1" },
      { run: noUv, existsFn: exists, scriptOverride: "C:/cache/codex_completion_oracle.py", spawn: async () => ({ code: 0, stdout: "", stderr: "" }) },
    );
    expect(result).toMatchObject({ kind: "engine-unavailable", reason: expect.stringMatching(/uv isn't installed/i) });
  });

  it("script missing → engine-unavailable", async () => {
    const result = await runCodexOracle(
      { projectRoot: "C:/project", phase: "build", session: "sess-1" },
      { run: runUv, existsFn: () => false, spawn: async () => ({ code: 0, stdout: "", stderr: "" }) },
    );
    expect(result).toMatchObject({ kind: "engine-unavailable" });
  });

  it("non-JSON stdout → failed, never fabricates a verdict", async () => {
    const result = await runCodexOracle(
      { projectRoot: "C:/project", phase: "build", session: "sess-1" },
      {
        run: runUv,
        existsFn: exists,
        scriptOverride: "C:/cache/codex_completion_oracle.py",
        spawn: async () => ({ code: 1, stdout: "not json", stderr: "Traceback ...\nValueError: boom" }),
      },
    );
    expect(result).toEqual({ kind: "failed", reason: "ValueError: boom" });
  });
});
