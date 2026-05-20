#!/usr/bin/env node
/**
 * Retroactive backfill of phase-quality events for Iterate K (PR #14
 * merged) + Iterate M (PR #16 open). Closes B7 detective-audit
 * findings for the 13 user-facing K commits + 1 K merge commit + 1 M
 * commit + 2 phase_completed events.
 *
 * Pre-existing 33-other-commits gap is OUTSIDE this script's scope —
 * those belong to earlier campaigns whose event-log hygiene is a
 * separate cleanup.
 *
 * Run from project root:
 *   node .shipwright/planning/iterate/backfill-events.mjs
 */
import { execSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import crypto from "node:crypto";

const EVENTS_LOG = "shipwright_events.jsonl";

// Reuse the SHIPWRIGHT_SESSION_ID from the current claude session as
// the source-of-record for these retroactive events.
const SESSION_ID = process.env.SHIPWRIGHT_SESSION_ID ?? "81fa2282-b400-4b95-9af9-55727890b772";

// Iterate K commits (PR #14 merged). Order = chronological.
const ITERATE_K_COMMITS = [
  { sha: "814620c", intent: "fix", adr: "ADR-099", desc: "server-side ?1006h re-emit in replay-snapshot envelope (Iterate K)" },
  { sha: "bd9e3ea", intent: "fix", adr: "ADR-099", desc: "Iterate K v1: 30s periodic clearTextureAtlas + onScroll" },
  { sha: "4e8f938", intent: "fix", adr: "ADR-099", desc: "Iterate K v2: 10s periodic + term.refresh() after clear" },
  { sha: "f0ce31a", intent: "fix", adr: "ADR-099", desc: "Iterate K v3: conditional via onWriteParsed counter (skip when idle)" },
  { sha: "bf7b05f", intent: "fix", adr: "ADR-099", desc: "Iterate K v4: skip atlas-clear in alt-screen buffer" },
  { sha: "e9aa804", intent: "fix", adr: "ADR-099", desc: "Iterate K v5: split main = clear+refresh, alt = refresh-only" },
  { sha: "104435b", intent: "fix", adr: "ADR-099", desc: "Iterate K v6: burst-after-2s-quiet trigger via onWriteParsed" },
  { sha: "05724ca", intent: "fix", adr: "ADR-099", desc: "Iterate K Vite WS proxy: swallow ECONNRESET/ECONNABORTED/EPIPE" },
  { sha: "84c014c", intent: "test", adr: "ADR-090", desc: "Iterate K cherry-pick: D-e2e task-type matrix" },
  { sha: "e01bae9", intent: "fix", adr: "ADR-099", desc: "Iterate K v7: pre-init lastWriteTime + post-mount-settle backstop" },
  { sha: "f07a66d", intent: "fix", adr: "ADR-099", desc: "Iterate K v8: DOM wheel listener (Tabby pattern) + 10-scenario systematic Playwright probe" },
  { sha: "d67ada6", intent: "chore", adr: "ADR-099", desc: "Iterate K: ?atlasMaintenance=off kill switch + A/B regression probes (stills + video)" },
  { sha: "44102aa", intent: "fix", adr: "ADR-099", desc: "Iterate K v9: post-launch-settle backstop (4s after consumeLaunch) for Resume-click-in-long-mounted-tab" },
];

// Iterate K merge commit + Iterate M commit
const POST_K = [
  { sha: "3b8bc0d", intent: "merge", adr: "ADR-099", desc: "Merge PR #14: Iterate K v1-v9 (xterm.js 6.0 atlas-corruption workaround)" },
];

const ITERATE_M_COMMITS = [
  { sha: "28daae1", intent: "fix", adr: "ADR-099", desc: "Iterate M (Resume CTA active-state followup) + ADR-099 v10 (post-replay maintenance)" },
];

function shaFull(short) {
  return execSync(`git rev-parse ${short}`, { encoding: "utf8" }).trim();
}

function commitDate(sha) {
  return execSync(`git show -s --format=%cI ${sha}`, { encoding: "utf8" }).trim();
}

function evtId() {
  return "evt-" + crypto.randomBytes(4).toString("hex");
}

function makeWorkCompleted({ sha, intent, adr, desc }, source) {
  const full = shaFull(sha);
  return {
    v: 1,
    id: evtId(),
    ts: commitDate(sha),
    type: "work_completed",
    session: SESSION_ID,
    source,
    commit: full,
    intent,
    description: desc,
    adr_id: adr,
    backfilled_at: new Date().toISOString(),
    backfill_reason: "retroactive — iterate skill was bypassed in favor of direct commits; event added 2026-05-15 for B7 audit closure",
  };
}

function makePhaseCompleted({ phase, source, commits, finalSha }) {
  return {
    v: 1,
    id: evtId(),
    ts: commitDate(finalSha),
    type: "phase_completed",
    session: SESSION_ID,
    source,
    phase,
    commits: commits.map((c) => shaFull(c.sha)),
    description: `Phase '${phase}' completed retroactively. Spec docs + internal code review live at .shipwright/planning/iterate/.`,
    backfilled_at: new Date().toISOString(),
    backfill_reason: "retroactive — closes C1 Tier-1 fail for missing phase_completed events on iterate K + M",
  };
}

const events = [];
for (const c of ITERATE_K_COMMITS) events.push(makeWorkCompleted(c, "iterate-K-retro"));
for (const c of POST_K) events.push(makeWorkCompleted(c, "iterate-K-merge-retro"));
events.push(
  makePhaseCompleted({
    phase: "iterate",
    source: "iterate-K-retro",
    commits: [...ITERATE_K_COMMITS, ...POST_K],
    finalSha: "3b8bc0d",
  }),
);
for (const c of ITERATE_M_COMMITS) events.push(makeWorkCompleted(c, "iterate-M-retro"));
events.push(
  makePhaseCompleted({
    phase: "iterate",
    source: "iterate-M-retro",
    commits: ITERATE_M_COMMITS,
    finalSha: "28daae1",
  }),
);

// Append all events as JSONL.
const lines = events.map((e) => JSON.stringify(e) + "\n").join("");
appendFileSync(EVENTS_LOG, lines, "utf8");

console.log(`Appended ${events.length} events to ${EVENTS_LOG}.`);
console.log(`  ${ITERATE_K_COMMITS.length} Iterate K work_completed`);
console.log(`  ${POST_K.length} Iterate K merge`);
console.log(`  1 phase_completed (iterate, source=iterate-K-retro)`);
console.log(`  ${ITERATE_M_COMMITS.length} Iterate M work_completed`);
console.log(`  1 phase_completed (iterate, source=iterate-M-retro)`);
