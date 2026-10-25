/*
 * stack-profiles-create.ts — "create a custom profile from a bundled one".
 *
 * The ONLY write surface of the stack-profile feature, and deliberately tiny:
 * it copies a bundled profile's JSON under a NEW name into the project's
 * `.shipwright/profiles/` or the user's `~/.shipwright/profiles/`
 * (`SHIPWRIGHT_USER_PROFILES_DIR` overrides, same as the resolver). Rules:
 *   - the name is validated against the resolver's own NAME_RE and must be
 *     unused in EVERY source — shadowing a bundled profile is the resolver's
 *     "same-name shadow" regression case, so the UI never creates one;
 *   - `wx` open — an existing file is never overwritten (race-safe, no
 *     check-then-write window);
 *   - the result is validated through the resolver; a copy it rejects is
 *     removed again, so a failed create leaves nothing behind.
 */

import { promises as fsp } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  MAX_PROFILE_NAME_LENGTH,
  isProfileNameShape,
  listStackProfiles,
  validateStackProfile,
  type StackProfileDeps,
} from "./stack-profiles.js";

/** Names the resolver reserves as sentinels, never real profiles. */
const RESERVED = new Set(["generic", "detecting", "custom"]);
const WINDOWS_DEVICE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/;

export type StackProfileScope = "project" | "user";

export type CreateOutcome =
  | { status: "created"; name: string; path: string }
  | { status: "invalid-request"; reason: string }
  | { status: "exists"; reason: string }
  | { status: "failed"; reason: string };

export interface CreateStackProfileInput {
  from: string;
  name: string;
  scope: StackProfileScope;
  /** Required for scope "project" (destination). For scope "user" it only widens the
   *  collision check + validation to that project's own profiles. */
  projectRoot?: string;
}

export interface CreateStackProfileDeps extends StackProfileDeps {
  userProfilesDir?: string;
}

function samePath(a: unknown, b: string): boolean {
  if (typeof a !== "string") return false;
  const norm = (x: string) => (process.platform === "win32" ? path.resolve(x).toLowerCase() : path.resolve(x));
  return norm(a) === norm(b);
}

/** Names being created right now - two concurrent creates of one name never both run. */
const inFlight = new Set<string>();

export function userProfilesDir(deps: Pick<CreateStackProfileDeps, "userProfilesDir" | "homeDir"> = {}): string {
  return (
    deps.userProfilesDir ??
    (process.env.SHIPWRIGHT_USER_PROFILES_DIR?.trim() || undefined) ??
    path.join(deps.homeDir ?? os.homedir(), ".shipwright", "profiles")
  );
}

export function validateNewProfileName(name: unknown): string | null {
  if (typeof name === "string" && name.length > MAX_PROFILE_NAME_LENGTH) {
    return `Keep the name under ${MAX_PROFILE_NAME_LENGTH + 1} characters.`;
  }
  if (!isProfileNameShape(name)) {
    return "Use lowercase letters, digits and dashes only (it must start with a letter or digit).";
  }
  if (RESERVED.has(name) || WINDOWS_DEVICE.test(name)) return `“${name}” is reserved — pick another name.`;
  return null;
}

export async function createStackProfileFromBundled(
  input: CreateStackProfileInput,
  deps: CreateStackProfileDeps = {},
): Promise<CreateOutcome> {
  if (typeof input.name === "string" && inFlight.has(input.name)) {
    return { status: "exists", reason: `“${input.name}” is already being created.` };
  }
  inFlight.add(input.name);
  try {
    return await createUnlocked(input, deps);
  } finally {
    inFlight.delete(input.name);
  }
}

async function createUnlocked(
  input: CreateStackProfileInput,
  deps: CreateStackProfileDeps,
): Promise<CreateOutcome> {
  const nameProblem = validateNewProfileName(input.name);
  if (nameProblem) return { status: "invalid-request", reason: nameProblem };
  if (input.scope === "project" && !input.projectRoot) {
    return { status: "invalid-request", reason: "A project profile needs a project." };
  }

  const listed = await listStackProfiles({ projectRoot: input.projectRoot }, deps);
  if (listed.status !== "ok") {
    return { status: "failed", reason: listed.status === "failed" ? listed.reason : "The profile resolver isn't available." };
  }
  const source = listed.report.profiles.find((p) => p.name === input.from && p.source === "bundled");
  if (!source || !source.valid) {
    return { status: "invalid-request", reason: `“${input.from}” isn't a usable built-in profile.` };
  }
  if (listed.report.profiles.some((p) => p.name === input.name)) {
    return { status: "exists", reason: `A profile called “${input.name}” already exists.` };
  }

  let content: string;
  try {
    const data = JSON.parse(await fsp.readFile(source.path, "utf-8")) as Record<string, unknown>;
    content = `${JSON.stringify({ ...data, name: input.name }, null, 2)}\n`;
  } catch (err) {
    return { status: "failed", reason: `Couldn't read the built-in profile: ${String(err)}` };
  }

  const dir =
    input.scope === "project"
      ? path.join(input.projectRoot as string, ".shipwright", "profiles")
      : userProfilesDir(deps);
  const target = path.join(dir, `${input.name}.json`);
  try {
    await fsp.mkdir(dir, { recursive: true });
    // DO-NOT #10: a symlinked .shipwright / profiles dir must not redirect the write.
    if (input.scope === "project") {
      const rel = path.relative(await fsp.realpath(input.projectRoot as string), await fsp.realpath(dir));
      if (rel.startsWith("..") || path.isAbsolute(rel)) {
        return { status: "failed", reason: "The project's profiles folder points outside the project, so nothing was written." };
      }
    }
    await fsp.writeFile(target, content, { encoding: "utf-8", flag: "wx" });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") {
      return { status: "exists", reason: `A profile called “${input.name}” already exists.` };
    }
    return { status: "failed", reason: `Couldn't write the profile: ${String(err)}` };
  }

  const checked = await validateStackProfile({ name: input.name, projectRoot: input.projectRoot }, deps);
  // A copy stays ONLY on the resolver's explicit "valid" for THIS very file. Any
  // other outcome (invalid, unreachable, timeout, newer contract, or the resolver
  // resolving the name to a different file) removes the file this request created
  // (wx guarantees it is ours) and says exactly why.
  const sameFile =
    checked.status === "ok" && checked.report.valid && "path" in checked.report && samePath(checked.report.path, target);
  if (!sameFile) {
    const why =
      checked.status !== "ok"
        ? "the resolver couldn't be reached to check it"
        : !checked.report.valid
          ? "error" in checked.report ? checked.report.error : "the resolver rejected it"
          : "the resolver resolved that name to a different profile";
    try {
      await fsp.rm(target, { force: true });
    } catch {
      return { status: "failed", reason: `The new profile didn't validate (${why}) and couldn't be removed — delete ${target} by hand.` };
    }
    return { status: "failed", reason: `The new profile didn't validate (${why}), so it was removed again.` };
  }
  return { status: "created", name: input.name, path: target };
}
