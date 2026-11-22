import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { runReminderDue, runReminderWrite, type ReminderCliDeps } from "./reminder-cli-runner.js";
import { GOOD_ANSWER } from "./reminder-fixtures.js";

const runUv = async () => ({ ok: true, stdout: "uv 0.11.9", stderr: "" });
const noUv = async () => ({ ok: false, stdout: "", stderr: "" });
const SCRIPT = "C:/cache/reminder_cli.py";

function deps(spawn: ReminderCliDeps["spawn"], extra: Partial<ReminderCliDeps> = {}): ReminderCliDeps {
  return { run: runUv, existsFn: () => true, scriptOverride: SCRIPT, spawn, ...extra };
}

describe("reminder CLI bridge: due", () => {
  it("runs via `uv run --no-project --python >=3.11`, fixed argv, parses the contract", async () => {
    const seen: { bin: string; args: string[] }[] = [];
    const r = await runReminderDue("C:/project", deps(async (bin, args) => {
      seen.push({ bin, args });
      return { code: 0, stdout: JSON.stringify(GOOD_ANSWER), stderr: "" };
    }));
    expect(seen[0].bin).toBe("uv");
    expect(seen[0].args).toEqual(["run", "--no-project", "--python", ">=3.11", SCRIPT, "--project-root=C:/project", "due", "--json"]);
    expect(r.kind).toBe("ok");
  });

  it("a project registered at a linked worktree is called from its MAIN checkout", async () => {
    const base = mkdtempSync(path.join(os.tmpdir(), "rem-wt-"));
    try {
      const main = path.join(base, "main");
      const wt = path.join(base, "wt");
      mkdirSync(path.join(main, ".git", "worktrees", "wt"), { recursive: true });
      mkdirSync(wt, { recursive: true });
      writeFileSync(path.join(wt, ".git"), `gitdir: ${path.join(main, ".git", "worktrees", "wt")}
`);
      const roots: string[] = [];
      const spawn = async (_b: string, args: string[]) => { roots.push(args[5]); return { code: 0, stdout: JSON.stringify(GOOD_ANSWER), stderr: "" }; };
      await runReminderDue(wt, deps(spawn));
      await runReminderWrite(wt, { operation: "done", id: "rem-aabbccdd" }, deps(spawn));
      expect(roots).toEqual([`--project-root=${main}`, `--project-root=${main}`]);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("CLI script missing or uv missing -> engine-unavailable, never a python fallback", async () => {
    let spawned = 0;
    const spawn = async () => { spawned++; return { code: 0, stdout: "", stderr: "" }; };
    expect(await runReminderDue("C:/p", deps(spawn, { existsFn: () => false }))).toMatchObject({ kind: "engine-unavailable", reason: expect.stringMatching(/isn't installed/) });
    expect(await runReminderDue("C:/p", deps(spawn, { run: noUv }))).toMatchObject({ kind: "engine-unavailable", reason: expect.stringMatching(/uv isn't installed/) });
    expect(spawned).toBe(0);
    expect(await runReminderDue("C:/p", deps(async () => ({ code: -1, stdout: "", stderr: "", spawnError: "ENOENT" })))).toMatchObject({ kind: "engine-unavailable" });
  });

  it("unreadable answer and unknown contractVersion are error states", async () => {
    expect(await runReminderDue("C:/p", deps(async () => ({ code: 0, stdout: "not json", stderr: "" })))).toMatchObject({ kind: "unreadable" });
    expect(await runReminderDue("C:/p", deps(async () => ({ code: 0, stdout: JSON.stringify({ ...GOOD_ANSWER, contractVersion: 9 }), stderr: "" })))).toEqual({ kind: "unsupported-version", contractVersion: 9 });
  });

  it("exit 4 -> store-busy; other non-zero and timeout -> failed (never an empty list)", async () => {
    expect(await runReminderDue("C:/p", deps(async () => ({ code: 4, stdout: "", stderr: "error: the reminder store is busy or unreadable: x" })))).toMatchObject({ kind: "store-busy" });
    expect(await runReminderDue("C:/p", deps(async () => ({ code: 1, stdout: "", stderr: "Traceback..." })))).toMatchObject({ kind: "failed" });
    expect(await runReminderDue("C:/p", deps(async () => ({ code: 124, stdout: "", stderr: "", spawnError: "timeout" })))).toMatchObject({ kind: "failed", reason: expect.stringMatching(/too long/) });
  });
});

describe("reminder CLI bridge: writes", () => {
  it("done and snooze use `--` before the id so it can never read as an option", async () => {
    const calls: string[][] = [];
    const spawn = async (_b: string, args: string[]) => { calls.push(args); return { code: 0, stdout: "done rem-aabbccdd  done  2026-11-20  T\n", stderr: "" }; };
    const d = await runReminderWrite("C:/p", { operation: "done", id: "rem-aabbccdd" }, deps(spawn));
    await runReminderWrite("C:/p", { operation: "snooze", id: "rem-aabbccdd", until: "2026-12-01" }, deps(spawn));
    expect(d).toMatchObject({ kind: "ok", operation: "done" });
    expect(calls[0].slice(5)).toEqual(["--project-root=C:/p", "done", "--", "rem-aabbccdd"]);
    expect(calls[1].slice(5)).toEqual(["--project-root=C:/p", "snooze", "--until=2026-12-01", "--", "rem-aabbccdd"]);
  });

  it("add passes every field as --flag=value, links as LABEL=url=REF, title after `--`", async () => {
    let args: string[] = [];
    const r = await runReminderWrite("C:/p", {
      operation: "add", title: "-looks like a flag", due: "2026-12-01", why: "-because", decided: "d", open: "o", command: "claude --resume abc",
      links: [{ label: "Docs", ref: "https://example.com/?a=b" }],
    }, deps(async (_b, a) => { args = a; return { code: 0, stdout: JSON.stringify({ id: "rem-11112222", title: "x" }), stderr: "" }; }));
    expect(args.slice(6)).toEqual([
      "add", "--due=2026-12-01", "--why=-because", "--decided=d", "--open=o", "--command=claude --resume abc",
      "--link=Docs=url=https://example.com/?a=b", "--json", "--", "-looks like a flag",
    ]);
    expect(r).toMatchObject({ kind: "ok", operation: "add", reminder: { id: "rem-11112222" } });
  });

  it("passes the CLI's secret-refusal message through unchanged, with no retry", async () => {
    let calls = 0;
    const text = "The text in `why` looks like it contains a secret (a key, token, password or a URL with credentials). Reminders are shown and mailed in plain text, so reword it without the secret, for example name where it is kept instead.";
    const r = await runReminderWrite("C:/p", { operation: "add", title: "t", due: "2026-12-01", why: "w" }, deps(async () => { calls++; return { code: 2, stdout: "", stderr: `error: ${text}\n` }; }));
    expect(r).toEqual({ kind: "refused", message: text });
    expect(calls).toBe(1);
  });

  it("argparse usage errors (also exit 2) are a failure, never shown as a content refusal", async () => {
    const add = { operation: "add", title: "t", due: "2026-12-01", why: "w" } as const;
    const usage = ["usage: reminder_cli.py [-h] add", "reminder_cli.py: error: unrecognized arguments: --foo"].join(String.fromCharCode(10));
    expect(await runReminderWrite("C:/p", add, deps(async () => ({ code: 2, stdout: "", stderr: usage })))).toMatchObject({ kind: "failed" });
    expect(await runReminderWrite("C:/p", add, deps(async () => ({ code: -1, stdout: "", stderr: "", spawnError: "E2BIG" })))).toMatchObject({ kind: "failed" });
  });

  it("maps not-found, busy, unreadable add output and unavailable engine", async () => {
    const w = { operation: "done", id: "rem-zzzzzzzz" } as const;
    expect(await runReminderWrite("C:/p", w, deps(async () => ({ code: 3, stdout: "", stderr: "error: no reminder with id rem-zzzzzzzz" })))).toEqual({ kind: "not-found", message: "no reminder with id rem-zzzzzzzz" });
    expect(await runReminderWrite("C:/p", w, deps(async () => ({ code: 4, stdout: "", stderr: "error: busy" })))).toMatchObject({ kind: "store-busy" });
    const add = { operation: "add", title: "t", due: "2026-12-01", why: "w" } as const;
    expect(await runReminderWrite("C:/p", add, deps(async () => ({ code: 0, stdout: "nope", stderr: "" })))).toMatchObject({ kind: "unreadable" });
    expect(await runReminderWrite("C:/p", add, deps(async () => ({ code: 0, stdout: "{}", stderr: "" })))).toMatchObject({ kind: "unreadable" });
    expect(await runReminderWrite("C:/p", w, deps(async () => ({ code: 0, stdout: "", stderr: "" }), { run: noUv }))).toMatchObject({ kind: "engine-unavailable" });
  });

  it("static guard: the bridge never touches reminders.jsonl or writes files itself", () => {
    for (const f of ["reminder-cli-runner.ts", "reminder-contract.ts", "reminder-validation.ts", "../routes/reminders.ts"]) {
      const src = readFileSync(new URL(f, import.meta.url), "utf-8").replace(/\/\*[\s\S]*?\*\//g, "");
      expect(src, f).not.toMatch(/writeFile|appendFile|createWriteStream|proper-lockfile|reminders\.jsonl/);
    }
  });
});
