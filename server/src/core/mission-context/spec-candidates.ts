/*
 * core/mission-context/spec-candidates.ts — every candidate PATH at which a
 * run's spec document may live, in preference order.
 *
 * Three builders, in increasing order of how much they trust their input, and
 * ALL of them emit only known-layout segment arrays — the caller still runs
 * pathGuard + realPathGuard on whatever it opens, which remains the actual
 * security boundary (§5.1):
 *
 *   1. `specCandidates`         — pure layout, from run_id + slug alone.
 *   2. `specHintCandidate`      — the `spec` path the framework recorded in
 *                                 `iterates/<run_id>.json`, grammar-validated.
 *   3. `campaignSpecCandidates` — a campaign sub-iterate path rebuilt from the
 *                                 never-evicted `work_completed` event, so it
 *                                 survives the agent-doc's 50-entry retention
 *                                 window (trg-92c0c36b).
 *
 * Split out of `iterate-record.ts` when (3) pushed that file past the 300-LOC
 * ceiling; that module keeps the RECORD reads (agent-doc + event lookup), this
 * one owns PATH construction.
 */

import { readdirSync } from "node:fs";

import { pathGuard } from "../path-guard.js";
import { isSafeRunId } from "./pointer.js";

/** Bounds a pathological sub-iterates directory (CONTRACT §11). */
const MAX_CAMPAIGN_DIR_ENTRIES = 1000;

/**
 * Candidate SPEC document locations, in preference order, built from the KNOWN
 * LAYOUT only — never from a pointer- or record-supplied sub-path (§5.1c).
 *
 * Both real layouts are covered: the per-run directory
 * (`…/iterate/<run_id>/mini-plan.md`) and the flat file
 * (`…/iterate/<date-slug>.md`, i.e. the run_id minus its `iterate-` prefix,
 * which is the shape the `spec` field records).
 */
export function specCandidates(runId: string, slug: string | null): string[][] {
  const base = [".shipwright", "planning", "iterate"];
  const dateSlug = runId.startsWith("iterate-") ? runId.slice("iterate-".length) : runId;
  const candidates: string[][] = [
    [...base, runId, "mini-plan.md"],
    [...base, runId, "adr.md"],
    [...base, `${runId}.md`],
    [...base, `${dateSlug}.md`],
  ];
  if (slug && slug !== dateSlug) candidates.push([...base, `${slug}.md`]);
  return candidates;
}

/**
 * The `spec` path RECORDED BY THE FRAMEWORK in `iterates/<run_id>.json`,
 * validated into known-layout segments — or null.
 *
 * Why this exists (PROBE, 2026-07-18): measuring the 206 real iterate runs in
 * this repo, the known-layout candidates resolve 82; 105 have genuinely no
 * document left on disk; and **19 have a real spec the candidates MISS** —
 * campaign SUB-ITERATE specs, which live at
 * `.shipwright/planning/iterate/campaigns/<campaign>/sub-iterates/<ID>-<slug>.md`.
 * That is this very campaign's own layout, so without this a campaign
 * sub-iterate would show no Spec artifact at all.
 *
 * This is NOT a relaxation of §5.1. That rule forbids trusting a sub-path from
 * the POINTER — untrusted, out-of-process input. This value comes from the
 * framework's own agent-doc, and it is still fully constrained here:
 *   - it must live under `.shipwright/planning/iterate/` (so a recorded
 *     `01-adopted/spec.md#FR-01.25` — the whole project spec, which would be
 *     misleading as "the plan for this run" — is rejected along with anything
 *     outside the iterate tree);
 *   - any `#fragment` is dropped;
 *   - every segment must pass the strict id grammar (kills `..`, separators,
 *     encoded separators and unusual Unicode);
 *   - it must end in `.md`;
 * and the caller still runs pathGuard + realPathGuard against the chosen root,
 * which remains the actual security boundary.
 */
export function specHintCandidate(hint: string | null | undefined): string[] | null {
  if (typeof hint !== "string" || hint.length === 0 || hint.length > 512) return null;
  const withoutFragment = hint.split("#")[0].trim();
  if (!withoutFragment.toLowerCase().endsWith(".md")) return null;

  const parts = withoutFragment.replace(/\\/g, "/").split("/").filter((p) => p.length > 0);
  const prefix = [".shipwright", "planning", "iterate"];
  if (parts.length <= prefix.length) return null;
  for (let i = 0; i < prefix.length; i++) {
    if (parts[i] !== prefix[i]) return null;
  }
  // Every remaining segment must be a safe id (the `.md` leaf included).
  for (const seg of parts.slice(prefix.length)) {
    if (!isSafeRunId(seg)) return null;
  }
  return parts;
}

/**
 * Campaign sub-iterate spec candidates, rebuilt from the NEVER-EVICTED event
 * facts (`campaign` + `sub_iterate_id` on `work_completed`).
 *
 * Why this exists (trg-92c0c36b). `iterates/<run_id>.json` is a bounded 50-entry
 * recency window (`append_iterate_entry` retention), and for a campaign
 * sub-iterate its `spec` hint is the ONLY thing that resolves the Spec artifact
 * — the known-layout candidates cannot name a path they have no campaign slug
 * for. So today a sub-iterate's Spec silently vanishes the moment its agent-doc
 * ages out. PROBE, 2026-07-21, this repo: 214 iterate runs in the event log but
 * only 54 surviving agent-docs (160 evicted, 75%); 14 of the survivors resolve
 * ONLY via the hint, and 28 runs' specs are reachable from the event facts
 * where the known layout misses. Rebuilding from the append-only log makes that
 * resolution survive eviction instead of decaying with it.
 *
 * `spec` itself is NOT read from the event log: measured on the same corpus it
 * is present on 1 of 54 rows, so it is not a substitute source — the campaign
 * slug (55 rows) and sub-iterate id (54 rows) are.
 *
 * Trust model — UNCHANGED from `specHintCandidate`: the two values come from
 * the framework's own event log, contribute exactly TWO path segments, and the
 * layout around them is hard-coded here. Both must pass the strict id grammar
 * (kills `..`, separators, encoded separators, unusual Unicode), the directory
 * read is `pathGuard`ed, only regular files are offered (a symlink is never a
 * candidate), and the caller still runs pathGuard + realPathGuard on whatever
 * it opens — which remains the actual security boundary.
 */
export function campaignSpecCandidates(
  root: string,
  campaign: string | null | undefined,
  subIterateId: string | null | undefined,
): string[][] {
  if (!isSafeRunId(campaign) || !isSafeRunId(subIterateId)) return [];

  const rel = [".shipwright", "planning", "iterate", "campaigns", campaign, "sub-iterates"];
  const guard = pathGuard(root, rel.join("/"));
  if (!guard.ok) return [];

  let names: string[];
  try {
    names = readdirSync(guard.absolute, { withFileTypes: true })
      // Bounded, so a pathological directory cannot turn a poll into a stall
      // (CONTRACT §11). Real sub-iterate directories hold tens of entries.
      .slice(0, MAX_CAMPAIGN_DIR_ENTRIES)
      // Regular files ONLY — `isFile()` is false for a symlink, so a link is
      // never even offered as a candidate.
      .filter((e) => e.isFile())
      .map((e) => e.name);
  } catch {
    // ENOENT / ENOTDIR / EACCES — this run simply has no campaign spec here.
    return [];
  }

  const exact = `${subIterateId.toLowerCase()}.md`;
  // The trailing `-` is load-bearing: without it `W1` would also claim `W10-…`.
  const prefix = `${subIterateId.toLowerCase()}-`;

  return names
    .filter((n) => {
      if (!isSafeRunId(n)) return false;
      const l = n.toLowerCase();
      return l.endsWith(".md") && (l === exact || l.startsWith(prefix));
    })
    // Deterministic order — an exact `<id>.md` outranks a `<id>-<slug>.md`, then
    // lexicographic. A stable order matters: the caller mints the document id
    // from the candidate it matched.
    .sort((a, b) => {
      const rank = Number(a.toLowerCase() !== exact) - Number(b.toLowerCase() !== exact);
      return rank !== 0 ? rank : a.localeCompare(b);
    })
    .map((n) => [...rel, n]);
}
