/*
 * Browser-safe absolute-path check for the rule-bound proposal fields
 * (`leadProjectRoots` / `leadPluginDirs`) — NOT `charter_path`/
 * `learnings_path`, which the card requires to stay relative. Defense in
 * depth: every path value in this wizard is machine-selected (project.path
 * from `useProjects()`), never typed, but the card is explicit that this
 * check gates both the verdict call and the final write.
 */
import type { LeadProposal } from "./buildLeadProposal";

const WINDOWS_DRIVE_RE = /^[A-Za-z]:[\\/]/;
const UNC_RE = /^\\\\[^\\]+\\[^\\]+/;

// External-review fix (GLM, low): a substring check on ".." rejected a
// legitimate absolute path with ".." inside a longer segment name (e.g.
// "/abs/project..name/foo") — split on both separators and only reject an
// actual ".." SEGMENT (a real parent-traversal step).
function hasTraversalSegment(p: string): boolean {
  return p.split(/[\\/]/).some((segment) => segment === "..");
}

export function isAbsolutePath(p: string): boolean {
  if (!p) return false;
  if (hasTraversalSegment(p)) return false;
  if (p.startsWith("/")) return true;
  if (WINDOWS_DRIVE_RE.test(p)) return true;
  if (UNC_RE.test(p)) return true;
  return false;
}

export interface PathCheckResult {
  ok: boolean;
  badFields: string[];
}

export function checkProposalPaths(proposal: LeadProposal): PathCheckResult {
  const badFields: string[] = [];
  if (!isAbsolutePath(proposal.daemonConfigAdditions.path)) badFields.push("leadProjectRoots");
  proposal.daemonConfigAdditions.pluginDirs.forEach((d, i) => {
    if (!isAbsolutePath(d)) badFields.push(`leadPluginDirs[${i}]`);
  });
  return { ok: badFields.length === 0, badFields };
}
