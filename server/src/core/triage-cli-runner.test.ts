import { describe, expect, it } from "vitest";

import { runTriageCli, triageWriteAvailability } from "./triage-cli-runner.js";

const runPython = async () => ({ ok: true, stdout: "Python 3.12.0", stderr: "" });
const exists = () => true;

describe("triage CLI writer bridge", () => {
  it("uses fixed argv, parses the resulting item, and never writes in TypeScript", async () => {
    const calls: string[][] = [];
    const result = await runTriageCli(
      { projectRoot: "C:/project", operation: "dismiss", itemId: "trg-aaaa1111", args: ["--reason=done"] },
      {
        run: runPython,
        existsFn: exists,
        scriptOverride: "C:/cache/triage_cli.py",
        spawn: async (_bin, args) => {
          calls.push(args);
          return { code: 0, stdout: JSON.stringify({ operation: "dismiss", item: { id: "trg-aaaa1111", status: "dismissed" } }), stderr: "" };
        },
      },
    );
    expect(calls[0]).toEqual([
      "C:/cache/triage_cli.py", "--project-root", "C:/project", "dismiss", "trg-aaaa1111", "--reason=done", "--json",
    ]);
    expect(result).toEqual({ kind: "ok", operation: "dismiss", item: { id: "trg-aaaa1111", status: "dismissed" } });
  });

  it("maps the CLI's stable CAS refusal separately from engine failure", async () => {
    const base = {
      run: runPython,
      existsFn: exists,
      scriptOverride: "C:/cache/triage_cli.py",
      spawn: async () => ({ code: 3, stdout: "", stderr: "status precondition failed" }),
    };
    await expect(runTriageCli({ projectRoot: "C:/project", operation: "snooze", itemId: "trg-bbbb2222", args: [] }, base)).resolves.toEqual({ kind: "precondition" });
    await expect(triageWriteAvailability({ ...base, run: async () => ({ ok: false, stdout: "", stderr: "" }) })).resolves.toMatchObject({
      available: false,
      reason: "No working Python (3.11+) was found.",
    });
  });

  it("maps engine, timeout, malformed, and invalid JSON outcomes without a fallback", async () => {
    const base = { run: runPython, existsFn: exists, scriptOverride: "C:/cache/triage_cli.py" };
    const input = { projectRoot: "C:/project", operation: "amend" as const, itemId: "trg-cccc3333", args: [] };
    await expect(runTriageCli(input, { ...base, spawn: async () => ({ code: -1, stdout: "", stderr: "" }) })).resolves.toMatchObject({ kind: "engine-unavailable" });
    await expect(runTriageCli(input, { ...base, spawn: async () => ({ code: 124, stdout: "", stderr: "", spawnError: "timeout" }) })).resolves.toEqual({ kind: "failed", reason: "Triage writing took too long and was stopped." });
    await expect(runTriageCli(input, { ...base, spawn: async () => ({ code: 2, stdout: "", stderr: "bad option\n" }) })).resolves.toEqual({ kind: "failed", reason: "bad option" });
    await expect(runTriageCli(input, { ...base, spawn: async () => ({ code: 0, stdout: "not json", stderr: "" }) })).resolves.toEqual({ kind: "failed", reason: "The triage write engine didn't return valid JSON." });
  });
});
