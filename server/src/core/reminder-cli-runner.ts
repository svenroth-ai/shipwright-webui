/*
 * reminder-cli-runner — the Command Center's ONLY bridge to reminder data.
 *
 * The WebUI NEVER writes `.shipwright/reminders.jsonl` (its own lockfile does
 * not coordinate with the Python FileLock) and there is deliberately NO
 * TypeScript fallback: an unavailable CLI disables the UI instead. Every call
 * is `uv run --no-project --python ">=3.11" reminder_cli.py ...`, the same
 * pattern and the same spawn helper (`cli-child-spawn.ts`) as
 * `triage-cli-runner.ts`; `--no-project` for the same reason (never pick up an
 * ambient pyproject.toml from the spawning process's cwd).
 *
 * `projectRoot` is the registered project path; it is resolved to its MAIN
 * checkout (`reminder-main-root.ts`) before the CLI is called, because the
 * triage half of `due` reads from the checkout top of the path it is given.
 *
 * Argv is built without a shell. Every value is passed in `--flag=value` form
 * and positionals follow a `--`, so a value that starts with `-` can never be
 * read as an option.
 *
 * The CLI's plain refusal text (a secret in a field) is passed through
 * unchanged apart from its own `error: ` prefix; this module never retries,
 * rewords or works around it.
 */

import { existsSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { defaultCliChildSpawn, type CliChildSpawnFn } from "./cli-child-spawn.js";
import { READINESS_REPAIR_COMMAND, shipwrightCacheRoot, type RunFn } from "./readiness-probe.js";
import { resolveMainCheckout } from "./reminder-main-root.js";
import { parseDueAnswer, type ReminderDueView } from "./reminder-contract.js";
import { resolveUv } from "./uv-runner.js";

export const REMINDER_CLI_TIMEOUT_MS = 30_000;

export interface ReminderCliDeps {
  run?: RunFn;
  spawn?: CliChildSpawnFn;
  existsFn?: (p: string) => boolean;
  homeDir?: string;
  /** Test seam: does the project folder exist? */
  dirExists?: (p: string) => boolean;
  scriptOverride?: string;
  timeoutMs?: number;
  baseEnv?: NodeJS.ProcessEnv;
}

export interface ReminderAddInput {
  title: string;
  due: string;
  why: string;
  decided?: string;
  open?: string;
  command?: string;
  links?: { label: string; ref: string }[];
}

export type ReminderWriteInput =
  | { operation: "done"; id: string }
  | { operation: "snooze"; id: string; until: string }
  | ({ operation: "add" } & ReminderAddInput);

/** Shared failure states of every call. Nothing here ever reads as "nothing due". */
export type ReminderCliFailure =
  | { kind: "engine-unavailable"; reason: string; repairCommand: string }
  | { kind: "store-busy"; message: string }
  | { kind: "failed"; reason: string };

export type ReminderDueResult =
  | { kind: "ok"; view: ReminderDueView }
  | { kind: "unsupported-version"; contractVersion: unknown }
  | { kind: "unreadable"; reason: string }
  | ReminderCliFailure;

export type ReminderWriteResult =
  | { kind: "ok"; operation: "done" | "snooze"; output: string }
  | { kind: "ok"; operation: "add"; reminder: Record<string, unknown> }
  | { kind: "refused"; message: string }
  | { kind: "not-found"; message: string }
  | { kind: "unreadable"; reason: string }
  | ReminderCliFailure;

/** Resolve the cache-owned CLI shipped with the Shipwright runtime. */
export function resolveReminderCliScript(
  deps: Pick<ReminderCliDeps, "existsFn" | "homeDir" | "scriptOverride"> = {},
): string | null {
  const exists = deps.existsFn ?? existsSync;
  if (deps.scriptOverride) return exists(deps.scriptOverride) ? deps.scriptOverride : null;
  const candidate = path.join(
    shipwrightCacheRoot(deps.homeDir ?? os.homedir()),
    "shared", "scripts", "tools", "reminder_cli.py",
  );
  return exists(candidate) ? candidate : null;
}

const ENGINE_MISSING = "The reminder engine isn't installed.";
const UV_MISSING = "uv isn't installed — reminders need it to run in a managed Python 3.11+.";

function isDirectory(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function unavailable(reason: string): ReminderCliFailure {
  return { kind: "engine-unavailable", reason, repairCommand: READINESS_REPAIR_COMMAND };
}

const stderrLines = (stderr: string): string[] => stderr.split(/[\r\n]+/).map((l) => l.trim()).filter(Boolean);

/** The CLI prints `error: <message>` on stderr; return the message as it wrote it. */
function cliMessage(stderr: string): string {
  const lines = stderrLines(stderr);
  const own = [...lines].reverse().find((l) => l.startsWith("error: "));
  // No `error: ` line (a traceback, say): a generic text, never a stack frame.
  return own ? own.slice("error: ".length).slice(0, 1000) : "";
}

/** `uv` also exits 2 on its own failures and prints a plain `error:` line; those are not refusals. */
const UV_ERROR = /Caused by:|error: (No interpreter|Failed to|Could not|Requested|Unable to|.*Python (>=|download|interpreter)|.*toolchain)/i;

function isCliRefusal(stderr: string): boolean {
  const lines = stderrLines(stderr);
  if (UV_ERROR.test(stderr)) return false;
  return lines.some((l) => l.startsWith("error: ")) && !lines.some((l) => l.startsWith("usage:"));
}

interface Prepared {
  script: string;
  uv: NonNullable<Awaited<ReturnType<typeof resolveUv>>>;
}

async function prepare(deps: ReminderCliDeps): Promise<Prepared | ReminderCliFailure> {
  const script = resolveReminderCliScript(deps);
  if (!script) return unavailable(ENGINE_MISSING);
  const uv = await resolveUv({ run: deps.run, homeDir: deps.homeDir, baseEnv: deps.baseEnv });
  if (!uv) return unavailable(UV_MISSING);
  return { script, uv };
}

const isFailure = (p: Prepared | ReminderCliFailure): p is ReminderCliFailure => "kind" in p;

function baseArgs(script: string, projectRoot: string): string[] {
  return ["run", "--no-project", "--python", ">=3.11", script, `--project-root=${projectRoot}`];
}

/** Map exit codes common to every verb. Returns null when the code is 0. */
function commonFailure(code: number, spawnError: string | undefined, stderr: string): ReminderCliFailure | null {
  if (code === 0) return null;
  if (code === -1) {
    // Only a missing/denied uv is "engine unavailable"; anything else (E2BIG, bad arg) is a failure.
    if (spawnError === "ENOENT" || spawnError === "EACCES") return unavailable("uv couldn't start on this machine.");
    return { kind: "failed", reason: "The reminder engine could not be started." };
  }
  if (code === 4) return { kind: "store-busy", message: cliMessage(stderr) || "The reminder store is busy or unreadable." };
  return {
    kind: "failed",
    reason: spawnError === "timeout"
      ? "The reminder engine took too long and was stopped."
      : cliMessage(stderr) || "The reminder engine exited with an error.",
  };
}

/** `due --json` for one project, validated against the pinned contract. */
export async function runReminderDue(
  projectRoot: string,
  deps: ReminderCliDeps = {},
): Promise<ReminderDueResult> {
  const prep = await prepare(deps);
  if (isFailure(prep)) return prep;
  const root = resolveMainCheckout(projectRoot);
  if (!(deps.dirExists ?? isDirectory)(root)) return { kind: "failed", reason: "The project folder no longer exists." };
  const args = [...baseArgs(prep.script, root), "due", "--json"];
  const spawn = deps.spawn ?? defaultCliChildSpawn;
  const res = await spawn(prep.uv.bin, args, { timeoutMs: deps.timeoutMs ?? REMINDER_CLI_TIMEOUT_MS, env: prep.uv.env });
  const failure = commonFailure(res.code, res.spawnError, res.stderr);
  if (failure) return failure;
  const parsed = parseDueAnswer(res.stdout);
  if (parsed.kind === "ok") return { kind: "ok", view: parsed.view };
  return parsed;
}

function writeArgs(input: ReminderWriteInput): string[] {
  if (input.operation === "done") return ["done", "--", input.id];
  if (input.operation === "snooze") return ["snooze", `--until=${input.until}`, "--", input.id];
  const args = ["add", `--due=${input.due}`, `--why=${input.why}`];
  if (input.decided) args.push(`--decided=${input.decided}`);
  if (input.open) args.push(`--open=${input.open}`);
  if (input.command) args.push(`--command=${input.command}`);
  for (const l of input.links ?? []) args.push(`--link=${l.label}=url=${l.ref}`);
  args.push("--json", "--", input.title);
  return args;
}

/** done / snooze / add. The CLI is the only writer; this just calls it. */
export async function runReminderWrite(
  projectRoot: string,
  input: ReminderWriteInput,
  deps: ReminderCliDeps = {},
): Promise<ReminderWriteResult> {
  const prep = await prepare(deps);
  if (isFailure(prep)) return prep;
  const spawn = deps.spawn ?? defaultCliChildSpawn;
  const res = await spawn(
    prep.uv.bin,
    [...baseArgs(prep.script, resolveMainCheckout(projectRoot)), ...writeArgs(input)],
    { timeoutMs: deps.timeoutMs ?? REMINDER_CLI_TIMEOUT_MS, env: prep.uv.env },
  );
  // Exit 2 is also argparse's usage error (`usage:` / `<prog>: error:`): that is an
  // engine/version mismatch, not a refusal of the content. Only the CLI's own
  // `error: ` line counts as a refusal.
  if (res.code === 2) {
    return isCliRefusal(res.stderr)
      ? { kind: "refused", message: cliMessage(res.stderr) }
      : { kind: "failed", reason: "The reminder engine did not understand the request (its version may not match)." };
  }
  if (res.code === 3) return { kind: "not-found", message: cliMessage(res.stderr) || "No such reminder." };
  // A timed-out write may already have been applied before the kill: say so.
  if (res.spawnError === "timeout") {
    return { kind: "failed", reason: "The reminder engine took too long; the change may or may not have been saved. Refresh before trying again." };
  }
  const failure = commonFailure(res.code, res.spawnError, res.stderr);
  if (failure) return failure;
  if (input.operation !== "add") return { kind: "ok", operation: input.operation, output: res.stdout.trim() };
  try {
    const rec: unknown = JSON.parse(res.stdout);
    if (typeof rec !== "object" || rec === null || Array.isArray(rec) || typeof (rec as { id?: unknown }).id !== "string") {
      return { kind: "unreadable", reason: "The reminder engine returned an unrecognised response." };
    }
    return { kind: "ok", operation: "add", reminder: rec as Record<string, unknown> };
  } catch {
    return { kind: "unreadable", reason: "The reminder engine didn't return valid JSON." };
  }
}
