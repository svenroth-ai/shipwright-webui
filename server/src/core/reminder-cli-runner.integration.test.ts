/*
 * Real-CLI round trip (F0.5 surface=api): drives the production runner against the
 * real `reminder_cli.py` in a temp git repo. Skipped when the CLI or uv is absent
 * (CI without the Shipwright cache), so it can never fail for environment reasons.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { resolveReminderCliScript, runReminderDue, runReminderWrite } from "./reminder-cli-runner.js";

const script = resolveReminderCliScript();
let hasTools = true;
try {
  execFileSync("uv", ["--version"], { stdio: "ignore" });
  execFileSync("git", ["--version"], { stdio: "ignore" });
} catch { hasTools = false; }
const enabled = Boolean(script) && hasTools;

describe.skipIf(!enabled)("reminder CLI bridge against the real CLI", () => {
  const root = enabled ? mkdtempSync(path.join(os.tmpdir(), "rem-int-")) : "";
  afterAll(() => { if (root) rmSync(root, { recursive: true, force: true }); });

  beforeAll(() => {
    execFileSync("git", ["init", "-q", root]);
    execFileSync("git", ["-C", root, "commit", "--allow-empty", "-q", "-m", "init", "--no-gpg-sign"], {
      env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" },
    });
  });

  // @covers FR-01.04
  it("add -> due -> snooze -> done, and the secret refusal arrives unchanged", async () => {
    const added = await runReminderWrite(root, {
      operation: "add", title: "-Renew the cert", due: "2020-01-01", why: "-It expires", open: "Who renews?",
      command: "claude --resume 1234", links: [{ label: "Docs", ref: "https://example.com/?a=b" }],
    });
    expect(added.kind).toBe("ok");
    if (added.kind !== "ok" || added.operation !== "add") return;
    const id = added.reminder.id as string;

    const due = await runReminderDue(root);
    expect(due.kind).toBe("ok");
    if (due.kind !== "ok") return;
    const mine = due.view.items.find((i) => i.id === id);
    expect(mine).toMatchObject({ kind: "reminder", title: "-Renew the cert", why: "-It expires", command: "claude --resume 1234", links: [{ label: "Docs", kind: "url", ref: "https://example.com/?a=b" }] });

    expect((await runReminderWrite(root, { operation: "snooze", id, until: "2999-01-01" })).kind).toBe("ok");
    const after = await runReminderDue(root);
    expect(after.kind === "ok" && after.view.items.some((i) => i.id === id)).toBe(false);

    expect((await runReminderWrite(root, { operation: "done", id })).kind).toBe("ok");
    expect(await runReminderWrite(root, { operation: "done", id: "rem-00000000" })).toMatchObject({ kind: "not-found" });

    const refused = await runReminderWrite(root, { operation: "add", title: "t", due: "2030-01-01", why: "password=hunter2hunter2 api_key=sk-abcdefghijklmnop1234" });
    expect(refused.kind).toBe("refused");
    if (refused.kind === "refused") expect(refused.message).toMatch(/looks like it contains a secret/);
    expect(existsSync(path.join(root, ".shipwright", "reminders.jsonl"))).toBe(true);
  }, 120_000);
  // @covers FR-01.04
  it("embedded quotes, trailing backslashes and a lone -- title survive the argv round trip", async () => {
    const bs = String.fromCharCode(92);
    const why = `say "hi" in C:${bs}dir${bs}`;
    const added = await runReminderWrite(root, { operation: "add", title: "--", due: "2020-01-03", why, open: `a ${bs}${bs}" b${bs}` });
    expect(added.kind).toBe("ok");
    const due = await runReminderDue(root);
    if (due.kind !== "ok" || added.kind !== "ok" || added.operation !== "add") throw new Error("round trip failed");
    expect(due.view.items.find((i) => i.id === added.reminder.id)).toMatchObject({ title: "--", why, open: `a ${bs}${bs}" b${bs}` });
  }, 120_000);

  // @covers FR-01.04
  it("non-ASCII text, multi-line open and a title that looks like an option survive the argv round trip", async () => {
    const lf = String.fromCharCode(10);
    const open = ["Zeile eins: Café Über 日本語", "second line", "third"].join(lf);
    const added = await runReminderWrite(root, { operation: "add", title: "--due Überprüfung 日本", due: "2020-01-02", why: "Grund: ü", open });
    expect(added.kind).toBe("ok");
    const due = await runReminderDue(root);
    expect(due.kind).toBe("ok");
    if (due.kind !== "ok" || added.kind !== "ok" || added.operation !== "add") return;
    expect(due.view.items.find((i) => i.id === added.reminder.id)).toMatchObject({ title: "--due Überprüfung 日本", why: "Grund: ü", open });
  }, 120_000);
});
