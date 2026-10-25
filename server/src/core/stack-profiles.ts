/*
 * stack-profiles.ts — the READ-ONLY bridge to the monorepo's stack-profile
 * resolver CLI (`shared/scripts/tools/resolve_profile.py list|validate --json`,
 * cross-repo contract_version 1, mirrored in `types/stack-profile-contract.ts`).
 * The WebUI never re-implements the lookup order (project → user → bundled) or
 * the schema — it renders the resolver's verdict, exactly as the campaign DAG
 * renders the scheduler's (`campaign-readiness.ts`, which this mirrors).
 *
 * Spawn discipline: `uv run --no-project --python ">=3.11"`, shell:false,
 * fixed argv, honest engine-unavailable when uv / the script is absent — never
 * a silent fallback to the bundled `server/profiles/` snapshot (that snapshot
 * knows nothing of custom profiles, which is the point of this module).
 */

import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { defaultCliChildSpawn, type CliChildSpawnFn } from "./cli-child-spawn.js";
import { READINESS_REPAIR_COMMAND, shipwrightCacheRoot, type RunFn } from "./readiness-probe.js";
import { resolveUv } from "./uv-runner.js";
import {
  SUPPORTED_STACK_PROFILE_CONTRACT,
  type StackProfileListReport,
  type StackProfileValidateReport,
} from "../types/stack-profile-contract.js";

export const STACK_PROFILE_CLI_TIMEOUT_MS = 20_000;

/** Mirror of the resolver's NAME_RE + a filename-safe length cap. A name that
 *  fails this never reaches argv (a leading `-` would parse as an option). */
export const PROFILE_NAME_RE = /^[a-z0-9][a-z0-9-]*$/;
export const MAX_PROFILE_NAME_LENGTH = 64;
export function isProfileNameShape(name: unknown): name is string {
  return typeof name === "string" && name.length <= MAX_PROFILE_NAME_LENGTH && PROFILE_NAME_RE.test(name);
}

export type StackProfileOutcome<T> =
  | { status: "ok"; report: T }
  | { status: "unsupported-contract"; version: string }
  | { status: "engine-unavailable"; reason: string; repairCommand: string }
  | { status: "failed"; reason: string };

export interface StackProfileDeps {
  run?: RunFn;
  spawn?: CliChildSpawnFn;
  existsFn?: (p: string) => boolean;
  homeDir?: string;
  baseEnv?: NodeJS.ProcessEnv;
  scriptOverride?: string;
  timeoutMs?: number;
}

/** The cache-owned resolver CLI (`SHIPWRIGHT_RESOLVE_PROFILE_SCRIPT` overrides
 *  the location — isolated E2E stacks run with an ephemeral HOME). */
export function resolveProfileScript(
  deps: Pick<StackProfileDeps, "existsFn" | "homeDir" | "scriptOverride"> = {},
): string | null {
  const exists = deps.existsFn ?? existsSync;
  const candidate =
    deps.scriptOverride ??
    process.env.SHIPWRIGHT_RESOLVE_PROFILE_SCRIPT ??
    path.join(shipwrightCacheRoot(deps.homeDir ?? os.homedir()), "shared", "scripts", "tools", "resolve_profile.py");
  return exists(candidate) ? candidate : null;
}

function lastLine(text: string): string {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const err = [...lines].reverse().find((l) => l.startsWith("error:"));
  return (err ?? lines.pop() ?? "").replace(/^error:\s*/, "");
}

function isEntryShape(e: unknown): boolean {
  return (
    isObject(e) &&
    typeof e.name === "string" &&
    typeof e.path === "string" &&
    typeof e.valid === "boolean" &&
    (e.source === "project" || e.source === "user" || e.source === "bundled")
  );
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Run one resolver subcommand. `cliArgs` positions are fixed; the only caller-supplied
 *  values are a shape-checked profile name (`--name=...`) and a registry-sourced path. */
async function runResolver(
  cliArgs: string[],
  deps: StackProfileDeps,
): Promise<{ stdout: string; code: number; stderr: string } | StackProfileOutcome<never>> {
  const unavailable = (reason: string): StackProfileOutcome<never> => ({
    status: "engine-unavailable",
    reason,
    repairCommand: READINESS_REPAIR_COMMAND,
  });
  const script = resolveProfileScript(deps);
  if (!script) return unavailable("The Shipwright profile resolver isn't installed.");
  const uv = await resolveUv({ run: deps.run, homeDir: deps.homeDir, baseEnv: deps.baseEnv });
  if (!uv) return unavailable("uv isn't installed — profiles need it to run in a managed Python 3.11+.");

  const spawn = deps.spawn ?? defaultCliChildSpawn;
  const result = await spawn(
    uv.bin,
    ["run", "--no-project", "--python", ">=3.11", script, ...cliArgs],
    { timeoutMs: deps.timeoutMs ?? STACK_PROFILE_CLI_TIMEOUT_MS, env: uv.env },
  );
  if (result.code === -1) return unavailable("uv couldn't start on this machine.");
  if (result.spawnError === "timeout") {
    return { status: "failed", reason: "Reading the profiles took too long and was stopped." };
  }
  return { stdout: result.stdout, code: result.code, stderr: result.stderr };
}

function isOutcome(v: unknown): v is StackProfileOutcome<never> {
  return isObject(v) && typeof v.status === "string";
}

function parseJson(stdout: string): unknown {
  // `validate` prints a human line (`profile 'x': source=...`) before the JSON, so
  // parse from the first line that STARTS with a brace - a brace inside that
  // human line (a path, a name) must not be mistaken for the document.
  const m = /^\{/m.exec(stdout);
  if (!m) return undefined;
  try {
    return JSON.parse(stdout.slice(m.index));
  } catch {
    return undefined;
  }
}

export async function listStackProfiles(
  input: { projectRoot?: string },
  deps: StackProfileDeps = {},
): Promise<StackProfileOutcome<StackProfileListReport>> {
  const args = ["list", "--json", ...(input.projectRoot ? ["--project-root", input.projectRoot] : [])];
  const ran = await runResolver(args, deps);
  if (isOutcome(ran)) return ran;
  if (ran.code !== 0) return { status: "failed", reason: lastLine(ran.stderr) || "The profile resolver exited with an error." };

  const parsed = parseJson(ran.stdout);
  if (!isObject(parsed)) {
    return { status: "failed", reason: "The profile resolver returned something unreadable." };
  }
  const version = parsed.contract_version;
  if (version !== SUPPORTED_STACK_PROFILE_CONTRACT) {
    return { status: "unsupported-contract", version: String(version) };
  }
  if (!Array.isArray(parsed.profiles) || !parsed.profiles.every(isEntryShape)) {
    return { status: "failed", reason: "The profile resolver returned something unreadable." };
  }
  return { status: "ok", report: parsed as unknown as StackProfileListReport };
}

/** Validate one profile by NAME (resolved through the normal lookup order). A
 *  profile the resolver rejects is `{valid:false}` data, not a transport failure. */
export async function validateStackProfile(
  input: { name: string; projectRoot?: string },
  deps: StackProfileDeps = {},
): Promise<StackProfileOutcome<StackProfileValidateReport | { valid: false; name: string; error: string }>> {
  if (!isProfileNameShape(input.name)) {
    return { status: "ok", report: { valid: false, name: input.name, error: "That isn't a valid profile name." } };
  }
  const args = ["validate", "--json", `--name=${input.name}`, ...(input.projectRoot ? ["--project-root", input.projectRoot] : [])];
  const ran = await runResolver(args, deps);
  if (isOutcome(ran)) return ran;
  if (ran.code !== 0) {
    // 1/2/3 with the resolver's own "error:" line are verdicts (invalid / not found /
    // bad JSON). Anything else (a crash traceback) is an outage, not "your profile is bad".
    const verdict = [1, 2, 3].includes(ran.code) && /^error:/m.test(ran.stderr);
    if (!verdict) return { status: "failed", reason: lastLine(ran.stderr) || "The profile resolver crashed." };
    return { status: "ok", report: { valid: false, name: input.name, error: lastLine(ran.stderr) || "The profile is not valid." } };
  }
  const parsed = parseJson(ran.stdout);
  if (!isObject(parsed) || typeof parsed.valid !== "boolean") {
    return { status: "failed", reason: "The profile resolver returned something unreadable." };
  }
  // `validate --json` carries no contract_version today; if upstream ever adds
  // one, a different major must not be rendered as a green "valid".
  if (parsed.contract_version !== undefined && parsed.contract_version !== SUPPORTED_STACK_PROFILE_CONTRACT) {
    return { status: "unsupported-contract", version: String(parsed.contract_version) };
  }
  return { status: "ok", report: parsed as unknown as StackProfileValidateReport };
}
