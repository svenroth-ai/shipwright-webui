import { describe, expect, it } from "vitest";

import { runTriageCli, triageWriteAvailability } from "./triage-cli-runner.js";

/** A working uv resolver — resolveUv uses `run("uv", ["--version"])`. */
const runUv = async () => ({ ok: true, stdout: "uv 0.11.9", stderr: "" });
const noUv = async () => ({ ok: false, stdout: "", stderr: "" });
const exists = () => true;

describe("triage CLI writer bridge", () => {
  it("runs via `uv run --python`, fixed argv, parses the resulting item, never writes in TypeScript", async () => {
    const calls: string[][] = [];
    const bins: string[] = [];
    const result = await runTriageCli(
      { projectRoot: "C:/project", operation: "dismiss", itemId: "trg-aaaa1111", args: ["--reason=done"] },
      {
        run: runUv,
        existsFn: exists,
        scriptOverride: "C:/cache/triage_cli.py",
        spawn: async (bin, args) => {
          bins.push(bin);
          calls.push(args);
          return { code: 0, stdout: JSON.stringify({ operation: "dismiss", item: { id: "trg-aaaa1111", status: "dismissed" } }), stderr: "" };
        },
      },
    );
    expect(bins[0]).toBe("uv"); // never a bare python binary — see uv-runner.ts
    // triage_cli.py has no pyproject.toml of its own, so this is `--python`,
    // never `--project` (verified: `uv run --python ">=3.11" triage_cli.py
    // --help` exits 0 against the real shared/scripts/tools layout).
    // `--no-project` forces uv to never walk up from the spawning process's
    // cwd looking for an ambient pyproject.toml (Stage-3 doubt review).
    expect(calls[0]).toEqual([
      "run", "--no-project", "--python", ">=3.11", "C:/cache/triage_cli.py", "--project-root", "C:/project", "dismiss", "trg-aaaa1111", "--reason=done", "--json",
    ]);
    expect(result).toEqual({ kind: "ok", operation: "dismiss", item: { id: "trg-aaaa1111", status: "dismissed" } });
  });

  it("maps the CLI's stable CAS refusal separately from engine failure", async () => {
    const base = {
      run: runUv,
      existsFn: exists,
      scriptOverride: "C:/cache/triage_cli.py",
      spawn: async () => ({ code: 3, stdout: "", stderr: "status precondition failed" }),
    };
    await expect(runTriageCli({ projectRoot: "C:/project", operation: "snooze", itemId: "trg-bbbb2222", args: [] }, base)).resolves.toEqual({ kind: "precondition" });
    await expect(triageWriteAvailability({ ...base, run: noUv })).resolves.toMatchObject({
      available: false,
      reason: expect.stringMatching(/uv isn't installed/i),
    });
  });

  it("uv missing → engine-unavailable WITHOUT falling back to a bare python", async () => {
    const result = await runTriageCli(
      { projectRoot: "C:/project", operation: "dismiss", itemId: "trg-dddd4444", args: [] },
      { run: noUv, existsFn: exists, scriptOverride: "C:/cache/triage_cli.py", spawn: async () => ({ code: 0, stdout: "", stderr: "" }) },
    );
    expect(result).toMatchObject({ kind: "engine-unavailable", reason: expect.stringMatching(/uv isn't installed/i) });
  });

  it("maps engine, timeout, malformed, and invalid JSON outcomes without a fallback", async () => {
    const base = { run: runUv, existsFn: exists, scriptOverride: "C:/cache/triage_cli.py" };
    const input = { projectRoot: "C:/project", operation: "amend" as const, itemId: "trg-cccc3333", args: [] };
    await expect(runTriageCli(input, { ...base, spawn: async () => ({ code: -1, stdout: "", stderr: "" }) })).resolves.toMatchObject({ kind: "engine-unavailable" });
    await expect(runTriageCli(input, { ...base, spawn: async () => ({ code: 124, stdout: "", stderr: "", spawnError: "timeout" }) })).resolves.toEqual({ kind: "failed", reason: "Triage writing took too long and was stopped." });
    await expect(runTriageCli(input, { ...base, spawn: async () => ({ code: 2, stdout: "", stderr: "bad option\n" }) })).resolves.toEqual({ kind: "failed", reason: "bad option" });
    await expect(runTriageCli(input, { ...base, spawn: async () => ({ code: 0, stdout: "not json", stderr: "" }) })).resolves.toEqual({ kind: "failed", reason: "The triage write engine didn't return valid JSON." });
  });
});
