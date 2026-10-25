/*
 * stackProfilesApi.ts — client wrapper + types for /api/stack-profiles.
 *
 * Types are a verbatim mirror of the monorepo resolver's `list --json`
 * contract (contract_version 1) as passed through by
 * `server/src/core/stack-profiles.ts`. The client renders the resolver's
 * verdict (source, validity, error) — it never re-derives lookup order or
 * validity itself.
 */

import { httpJson } from "./externalApi";

export type StackProfileSource = "project" | "user" | "bundled";

export interface StackProfileEntry {
  name: string;
  source: StackProfileSource;
  path: string;
  valid: boolean;
  error: string | null;
  description: string | null;
}

export interface StackProfileListReport {
  contract_version: number;
  profiles: StackProfileEntry[];
  warnings: string[];
  searched: string[];
}

export type StackProfileOutcome<T> =
  | { status: "ok"; report: T }
  | { status: "unsupported-contract"; version: string }
  | { status: "engine-unavailable"; reason: string; repairCommand: string }
  | { status: "failed"; reason: string };

export type ValidateReport = { valid: true; name: string } | { valid: false; name: string; error: string };

export type CreateStackProfileResult =
  | { status: "created"; name: string; path: string }
  | { status: "invalid-request" | "exists" | "failed"; reason: string };

export const stackProfilesKey = (projectId?: string | null) => ["stack-profiles", projectId ?? null] as const;

export const SOURCE_LABEL: Record<StackProfileSource, string> = {
  project: "This project",
  user: "Your profiles",
  bundled: "Built-in",
};

export function getStackProfiles(projectId?: string | null): Promise<StackProfileOutcome<StackProfileListReport>> {
  const q = projectId ? `?projectId=${encodeURIComponent(projectId)}` : "";
  return httpJson(`/api/stack-profiles${q}`);
}

export function validateStackProfile(
  name: string,
  projectId?: string | null,
): Promise<StackProfileOutcome<ValidateReport>> {
  return httpJson("/api/stack-profiles/validate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, ...(projectId ? { projectId } : {}) }),
  });
}

/** Create answers with a 4xx body carrying the reason — read it, don't throw. */
export async function createStackProfile(input: {
  from: string;
  name: string;
  scope: "project" | "user";
  projectId?: string | null;
}): Promise<CreateStackProfileResult> {
  try {
    const r = await fetch("/api/stack-profiles", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    return (await r.json()) as CreateStackProfileResult;
  } catch {
    return { status: "failed", reason: "Couldn't reach the server." };
  }
}
