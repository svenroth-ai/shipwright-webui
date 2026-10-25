/*
 * briefIntake.ts - the wizard's brief line for the monorepo's brief intake, and the
 * profile-name rule that line depends on. Split out of contract.ts (bloat) with no
 * change of behaviour; contract.ts re-exports everything here.
 */

import type { NewAnswers } from "./types";
import type { StackProfileResolution } from "./contract";

/** Verbatim mirror of the server's `PROFILE_NAME_RE` / `MAX_PROFILE_NAME_LENGTH`
 *  (`server/src/core/stack-profiles.ts`, which mirrors the monorepo resolver's
 *  NAME_RE). The monorepo's brief intake refuses any other name, so the wizard
 *  never offers or sends one. No flag on purpose: a `g` flag makes `.test()`
 *  stateful. Drift guard: `client/src/test/profile-name-rule-sync.test.ts`. */
export const PROFILE_NAME_RE = /^[a-z0-9][a-z0-9-]*$/;
export const MAX_PROFILE_NAME_LENGTH = 64;
export function isProfileNameShape(name: unknown): name is string {
  return typeof name === "string" && name.length <= MAX_PROFILE_NAME_LENGTH && PROFILE_NAME_RE.test(name);
}

/** Every spelling (and Unicode case fold) the reader's `key: value` parser takes as the profile key. */
const STACK_LABEL = /[s\u017f]tac[k\u212a][\s\x1c-\x1f\x85_-]*prof[i\u0131\u0130]le\s*[:=]/gi;
/** The reader's `(Intake` matches Unicode case folds too (Kelvin sign, dotless i, dotted I). */
const INTAKE_MARK = /\(\s*[i\u0131\u0130]nta[k\u212a]e/gi;

/** User text for an `(Intake ...)` item: one line, no brackets / `;` / controls / label. */
function intakeText(text: string): string {
  return text
    .replace(/[();\x00-\x1f\x7f]/g, " ")
    .replace(STACK_LABEL, "stack profile -")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}

/**
 * Compose the full wizard intake into ONE brief line for `/shipwright-run` so its
 * brief-intake (B4/B5) doesn't re-ask what the wizard already answered (AC1 - "no
 * wizard question asked twice"). The idea leads; the `(Intake ...)` trailer follows
 * with the `Stack profile:` item FIRST (the monorepo reader requires it before any
 * inner bracket), then the answers. Single physical trailer line.
 */
export function composeNewBrief(
  answers: NewAnswers,
  resolution: StackProfileResolution,
): string {
  // The monorepo's brief intake (`brief_profile.py`) reads the LAST `(Intake` of the last
  // physical line: the `Stack profile:` item must sit before any inner bracket and a second
  // one makes it ambiguous. So the item comes FIRST (its own note is the only bracket the
  // reader tolerates, after the name), and user text is cleaned of everything that could
  // hide it or forge another (brackets, `;`, control chars, the label, a `(Intake` marker).
  // The idea stays the user's own prose (brackets, `;` and line breaks are legitimate there and
  // the reader only looks at the trailer); only what could be read AS the trailer or as a
  // `Stack profile:` line of a key: value brief is neutralised.
  const idea = (answers.brief?.trim() || "My idea").replace(INTAKE_MARK, "[intake").replace(STACK_LABEL, "stack profile -");
  const own = isProfileNameShape(answers.profile);
  const parts: string[] = [
    own
      ? `Stack profile: ${resolution.profile} (the user's own — do not re-ask the stack)`
      : `Stack profile: ${resolution.profile}`,
  ];
  if (answers.who) parts.push(`Users: ${intakeText(answers.who)}`);
  if (!own) {
    parts.push(`Saves data: ${intakeText(answers.remember ?? "Not sure yet")}`);
    if (answers.where) parts.push(`Runs: ${intakeText(answers.where)}`);
  }
  if (resolution.envVarsRequired) {
    parts.push("Supabase env vars will be needed at the Deploy step (not before)");
  }
  return `${idea} (Intake — ${parts.join("; ")}.)`;
}
