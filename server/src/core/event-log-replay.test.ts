/*
 * event-log-replay.test.ts — kill criterion 1 for the WebUI (events-drop-files,
 * issue 978, unit S1): every renderer is byte-identical on the UNSPLIT legacy log
 * vs the same log SPLIT into per-run drop files by the content-only splitter.
 *
 * Two fixtures: the monorepo S0 pair (copied verbatim from shipwright
 * `shared/tests/fixtures/events_layout/`, produced by the Python splitter) and a
 * campaign-rich log split here by the TS port (`test/events-split.ts`).
 *
 * @covers FR-01.47
 */

import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { applyEventsProjection, readCampaignEvents } from "./campaign-events.js";
import type { Campaign } from "./campaign-store.js";
import { readEventLog } from "./event-log-reader.js";
import { readRunData } from "./run-data-join.js";
import { _clearEventIndexCache, findWorkCompleted } from "./mission-context/iterate-record.js";
import { splitLog } from "../test/events-split.js";

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "test", "fixtures", "events_layout");
const roots: string[] = [];

function tmp(prefix: string): string {
  const d = mkdtempSync(path.join(tmpdir(), prefix));
  roots.push(d);
  return d;
}

afterEach(() => {
  _clearEventIndexCache();
  for (const d of roots.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** An unsplit tree and its split twin built from the same log text. */
function pair(unsplitText: string): { unsplit: string; split: string } {
  const unsplit = tmp("evr-unsplit-");
  writeFileSync(path.join(unsplit, "shipwright_events.jsonl"), unsplitText, "utf-8");
  const split = tmp("evr-split-");
  splitLog(unsplitText, split);
  return { unsplit, split };
}

/** Everything a renderer sees, minus the per-file status that only the split tree has. */
function renders(root: string): string {
  const { files: _f, duplicateIds: _d, ...events } = readEventLog(root);
  return JSON.stringify({
    events,
    runData: readRunData(root),
    campaigns: applyEventsProjection([], readCampaignEvents(root)),
  });
}

// A campaign-rich log: re-runs (later ts wins), an empty vs a real commit, an
// out-of-file-order ts, an unparseable ts, non-campaign rows and grade snapshots.
const CAMPAIGN_LOG = [
  { id: "c01", ts: "2026-10-01T09:00:00Z", type: "work_completed", adr_id: "iterate-2026-10-01-a", campaign: "2026-10-01-alpha", sub_iterate_id: "S1", commit: "" },
  { id: "c02", ts: "2026-10-01T10:00:00Z", type: "grade_snapshot", grade: "C", score: 61, session: "s-1" },
  { id: "c03", ts: "2026-10-02T09:00:00Z", type: "work_completed", adr_id: "iterate-2026-10-02-b", campaign: "2026-10-01-alpha", sub_iterate_id: "S2", commit: "bbb2222" },
  { id: "c04", ts: "2026-10-03T09:00:00Z", type: "work_completed", adr_id: "iterate-2026-10-03-a2", campaign: "2026-10-01-alpha", sub_iterate_id: "S1", commit: "aaa1111" },
  { id: "c05", ts: "2026-10-04T09:00:00Z", type: "phase_started", phase: "build", session: "s-2" },
  { id: "c06", ts: "2026-10-04T10:00:00+02:00", type: "work_completed", adr_id: "iterate-2026-10-04-c", campaign: "2026-10-04-beta", sub_iterate_id: "C10", commit: "ccc" },
  { id: "c07", ts: "2026-10-04T09:30:00Z", type: "work_completed", adr_id: "iterate-2026-10-04-c2", campaign: "2026-10-04-beta", sub_iterate_id: "C2", commit: "" },
  { id: "c08", ts: "2026-10-05T09:00:00Z", type: "work_completed", adr_id: "iterate-2026-10-05-plain", tests: { passed: 5, total: 5 } },
  { id: "c09", ts: "2026-10-05T10:00:00Z", type: "grade_snapshot", grade: "B", score: 78, session: "s-1" },
  { id: "c10", ts: "2026-10-06T09:00:00Z", type: "phase_completed", phase: "build", session: "s-2" },
].map((e) => JSON.stringify(e)).join("\n") + "\n";

// @covers FR-01.47
describe("KC1 replay — unsplit vs split render byte-identically", () => {
  it("the TS splitter reproduces the committed (Python-made) S0 split tree", () => {
    const text = readFileSync(path.join(FIXTURES, "unsplit.jsonl"), "utf-8");
    const out = tmp("evr-port-");
    const names = splitLog(text, out);
    const committed = path.join(FIXTURES, "split", ".shipwright/events/drops");
    expect(names).toEqual(readdirSync(committed).sort());
    for (const n of names) {
      const norm = (p: string) => readFileSync(p, "utf-8").replace(/\r\n/g, "\n");
      expect(norm(path.join(out, ".shipwright/events/drops", n))).toBe(norm(path.join(committed, n)));
    }
  });

  it("S0 fixture pair: events, run data and campaign status are identical", () => {
    const unsplit = tmp("evr-s0-");
    writeFileSync(path.join(unsplit, "shipwright_events.jsonl"), readFileSync(path.join(FIXTURES, "unsplit.jsonl")));
    const split = path.join(FIXTURES, "split");
    expect(readEventLog(split).runCount).toBe(5);
    expect(renders(split)).toBe(renders(unsplit));
  });

  it("campaign-rich log: campaign status (synthesized AND overlaid) is identical", () => {
    const { unsplit, split } = pair(CAMPAIGN_LOG);
    expect(renders(split)).toBe(renders(unsplit));
    // overlay mode: a locally present campaign skeleton with every step pending
    const skeleton = (): Campaign[] => {
      const c = applyEventsProjection([], readCampaignEvents(unsplit)).find((x) => x.slug === "2026-10-01-alpha")!;
      return [{ ...c, derivedFromEvents: false, steps: c.steps.map((s) => ({ ...s, status: "pending", commit: null })) }];
    };
    const overlay = (root: string) => JSON.stringify(applyEventsProjection(skeleton(), readCampaignEvents(root)));
    expect(overlay(split)).toBe(overlay(unsplit));
    const alpha = applyEventsProjection([], readCampaignEvents(split)).find((x) => x.slug === "2026-10-01-alpha")!;
    expect(alpha.steps.map((s) => [s.id, s.commit])).toEqual([["S1", "aaa1111"], ["S2", "bbb2222"]]);
  });

  it("Mission lookup answers the same on both trees", () => {
    const { unsplit, split } = pair(CAMPAIGN_LOG);
    for (const id of ["iterate-2026-10-05-plain", "iterate-2026-10-04-c", "iterate-nope"]) {
      const a = findWorkCompleted(unsplit, id);
      const b = findWorkCompleted(split, id);
      expect(b.status).toBe(a.status);
      if (a.status === "found" && b.status === "found") expect(b.run).toEqual(a.run);
    }
  });
});
