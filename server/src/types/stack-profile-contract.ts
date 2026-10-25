/*
 * stack-profile-contract.ts — verbatim mirror of the shipwright monorepo's
 * `shared/scripts/tools/resolve_profile.py list --json` / `validate --json`
 * output (CLAUDE.md DO-NOT #7: shared shapes are mirrors, never cross-package
 * imports). Cross-repo contract: `contract_version` 1. ANY shape change
 * upstream is a MAJOR bump; this build refuses an unrecognised major instead
 * of half-rendering it. Pinned by `server/src/test/fixtures/
 * resolve-profile-list.v1.json` + `stack-profiles-contract.test.ts`.
 */

export const SUPPORTED_STACK_PROFILE_CONTRACT = 1;

/** `explicit` only appears for `validate --file` — never in a `list`. */
export type StackProfileSource = "project" | "user" | "bundled";

export interface StackProfileEntry {
  name: string;
  source: StackProfileSource;
  path: string;
  valid: boolean;
  /** Why the profile is invalid; null when valid. */
  error: string | null;
  kind: string | null;
  schema_version: number | null;
  description: string | null;
  /** Same-named profiles in lower-priority locations this one hides. */
  shadows: unknown[];
}

export interface StackProfileListReport {
  contract_version: number;
  profiles: StackProfileEntry[];
  warnings: string[];
  searched: string[];
}

export interface StackProfileValidateReport {
  valid: boolean;
  name: string;
  source: string;
  path: string;
  schema_version: number | null;
  shadows: unknown[];
  warnings: string[];
  searched: string[];
}
