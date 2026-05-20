#!/usr/bin/env node
/**
 * Full retroactive backfill of phase-quality events for EVERY commit
 * since v0.9.0 that lacks a matching event in shipwright_events.jsonl.
 *
 * Closes B7 detective-audit finding completely. Earlier campaigns
 * (Iterate G/H/I/J, dynamic-stack-profiles, lead-foundation,
 * triage-tab, …) committed directly without writing events; this
 * script reconstructs a `work_completed` event per orphan commit
 * from git metadata.
 *
 * Run from project root:
 *   node .shipwright/planning/iterate/backfill-events-full.mjs
 */
import { execSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import crypto from "node:crypto";

const EVENTS_LOG = "shipwright_events.jsonl";
const SESSION_ID = process.env.SHIPWRIGHT_SESSION_ID ?? "81fa2282-b400-4b95-9af9-55727890b772";
const RELEASE_TAG = "v0.9.0";

// 1. All commit SHAs since the release tag.
const allShas = execSync(`git rev-list ${RELEASE_TAG}..HEAD`, { encoding: "utf8" })
  .trim()
  .split(/\r?\n/)
  .filter(Boolean);

// 2. Commit SHAs that already have an event.
const covered = new Set();
const logRaw = readFileSync(EVENTS_LOG, "utf8").trim().split(/\r?\n/);
for (const line of logRaw) {
  if (!line.trim()) continue;
  try {
    const e = JSON.parse(line);
    if (typeof e.commit === "string" && e.commit) {
      covered.add(e.commit);
      covered.add(e.commit.slice(0, 8));
    }
  } catch {
    /* skip malformed line */
  }
}

// 3. Map a conventional-commit subject → intent.
function intentFromSubject(subject) {
  const m = subject.match(/^(\w+)(?:\([^)]*\))?!?:/);
  const type = m ? m[1].toLowerCase() : "";
  switch (type) {
    case "feat":
      return "feature";
    case "fix":
      return "fix";
    case "test":
      return "test";
    case "docs":
      return "docs";
    case "refactor":
      return "change";
    case "chore":
      return "chore";
    case "perf":
      return "change";
    default:
      // Merge commits + anything non-conventional.
      return subject.startsWith("Merge ") ? "merge" : "change";
  }
}

// 4. ADR ref extracted from subject, if any.
function adrFromSubject(subject) {
  const m = subject.match(/\bADR-(\d{3})\b/);
  return m ? `ADR-${m[1]}` : null;
}

function evtId() {
  return "evt-" + crypto.randomBytes(4).toString("hex");
}

const events = [];
let skipped = 0;
for (const sha of allShas) {
  if (covered.has(sha) || covered.has(sha.slice(0, 8))) {
    skipped++;
    continue;
  }
  const subject = execSync(`git show -s --format=%s ${sha}`, { encoding: "utf8" }).trim();
  const ts = execSync(`git show -s --format=%cI ${sha}`, { encoding: "utf8" }).trim();
  const parents = execSync(`git show -s --format=%P ${sha}`, { encoding: "utf8" }).trim().split(/\s+/);
  const isMerge = parents.length > 1;
  events.push({
    v: 1,
    id: evtId(),
    ts,
    type: "work_completed",
    session: SESSION_ID,
    source: isMerge ? "backfill-merge-retro" : "backfill-retro",
    commit: sha,
    intent: intentFromSubject(subject),
    description: subject,
    adr_id: adrFromSubject(subject),
    backfilled_at: new Date().toISOString(),
    backfill_reason:
      "retroactive — B7 audit closure for commits made before the event-log discipline was applied (2026-05-15 cleanup)",
  });
}

if (events.length === 0) {
  console.log(`No orphan commits — all ${allShas.length} commits since ${RELEASE_TAG} already have events.`);
} else {
  const lines = events.map((e) => JSON.stringify(e) + "\n").join("");
  appendFileSync(EVENTS_LOG, lines, "utf8");
  console.log(`Appended ${events.length} backfill events to ${EVENTS_LOG}.`);
  console.log(`  ${skipped} commits already had events (skipped).`);
  console.log(`  ${allShas.length} total commits since ${RELEASE_TAG}.`);
}
