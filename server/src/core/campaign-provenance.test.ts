/*
 * The campaign store must say WHERE a status claim came from, and a degraded
 * read must not report as `ok` (triage `trg-2228d368`).
 *
 * The failure this pins: `readStatusJson` collapsed "absent" and "torn" into one
 * `null`, the store silently fell back to the `campaign.md` table, and the
 * mission artifact then rendered "S2 is running now." from a hand-maintained
 * plan document with nothing on screen indicating the live status file had been
 * unreadable. The fallback is useful and stays; only its silence goes.
 *
 * @covers FR-01.66
 */

import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { readCampaigns } from "./campaign-store.js";
import { readStatusJsonRead } from "./campaign-status-json.js";
import {
  buildCampaignProgressArtifact,
  buildSubIterateArtifact,
} from "./mission-context/campaign-artifacts.js";
import type { CampaignFact } from "./mission-context/campaign-facts.js";

const SLUG = "2026-07-18-example";

const CAMPAIGN_MD = `---
branch_strategy: serial
---

## Intent

Prove the store reports its own provenance.

## Sub-Iterates

| ID | Slug | Title | Status |
|----|------|-------|--------|
| S1 | one | First unit | complete |
| S2 | two | Second unit | in_progress |
`;

function makeCampaign(statusJson: string | null, md: string | null = CAMPAIGN_MD) {
  const root = mkdtempSync(path.join(tmpdir(), "sw-camp-"));
  const campaignsDir = path.join(root, ".shipwright", "planning", "iterate", "campaigns");
  const dir = path.join(campaignsDir, SLUG);
  mkdirSync(dir, { recursive: true });
  if (md !== null) writeFileSync(path.join(dir, "campaign.md"), md, "utf-8");
  if (statusJson !== null) writeFileSync(path.join(dir, "status.json"), statusJson, "utf-8");
  return { root, campaignsDir };
}

function read(campaignsDir: string, root: string) {
  return readCampaigns(campaignsDir, root).find((c) => c.slug === SLUG);
}

describe("readStatusJsonRead — absent and torn are different answers", () => {
  it("distinguishes ok / absent / unreadable", () => {
    const a = makeCampaign('{"sub_iterates":[{"id":"S1","status":"complete"}]}');
    const b = makeCampaign(null);
    const c = makeCampaign("{ half-written");
    try {
      expect(readStatusJsonRead(path.join(a.campaignsDir, SLUG)).state).toBe("ok");
      expect(readStatusJsonRead(path.join(b.campaignsDir, SLUG)).state).toBe("absent");
      // The collapse this fixes: a torn file used to be indistinguishable from
      // no file at all, so no consumer could know a read had failed.
      expect(readStatusJsonRead(path.join(c.campaignsDir, SLUG)).state).toBe("unreadable");
    } finally {
      for (const x of [a, b, c]) rmSync(x.root, { recursive: true, force: true });
    }
  });

  it("treats a JSON array or scalar as unreadable, not absent", () => {
    const a = makeCampaign("[1,2,3]");
    try {
      expect(readStatusJsonRead(path.join(a.campaignsDir, SLUG)).state).toBe("unreadable");
    } finally {
      rmSync(a.root, { recursive: true, force: true });
    }
  });
});

describe("campaign-store provenance", () => {
  it("reports status_json when the live file supplied a status", () => {
    const { root, campaignsDir } = makeCampaign(
      '{"sub_iterates":[{"id":"S1","status":"complete"},{"id":"S2","status":"in_progress"}]}',
    );
    try {
      const c = read(campaignsDir, root);
      expect(c?.provenance).toEqual({
        statusSource: "status_json",
        degraded: false,
        statusJsonState: "ok",
        campaignMdUnreadable: false,
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("reports campaign_md, NOT degraded, when status.json is merely absent", () => {
    const { root, campaignsDir } = makeCampaign(null);
    try {
      const c = read(campaignsDir, root);
      // A legacy campaign is not a fault. Marking it degraded would cry wolf.
      expect(c?.provenance).toEqual({
        statusSource: "campaign_md",
        degraded: false,
        // Absent, not unreadable — the distinction the disclosure depends on.
        statusJsonState: "absent",
        campaignMdUnreadable: false,
      });
      expect(c?.steps).toHaveLength(2);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("reports DEGRADED when status.json is there and torn", () => {
    const { root, campaignsDir } = makeCampaign("{ not json");
    try {
      const c = read(campaignsDir, root);
      expect(c?.provenance.degraded).toBe(true);
      expect(c?.provenance.statusSource).toBe("campaign_md");
      // The fallback still WORKS — that was never the problem.
      expect(c?.steps).toHaveLength(2);
      expect(c?.steps[1].status).toBe("in_progress");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("double degradation: an unparseable table AND a torn status file", () => {
    const { root, campaignsDir } = makeCampaign("{ not json", "# no table here at all\n");
    try {
      const c = read(campaignsDir, root);
      expect(c?.total).toBe(0);
      // `total: 0` alone is indistinguishable from a real empty campaign; the
      // degraded flag is the only thing that keeps it from being reported as one.
      expect(c?.provenance.degraded).toBe(true);
      expect(c?.provenance.statusSource).toBe("none");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("mission artifacts stop presenting a fallback as unqualified fact", () => {
  type Prov = {
    statusSource: "status_json" | "campaign_md" | "events" | "none";
    degraded: boolean;
    statusJsonState?: "ok" | "absent" | "unreadable";
    campaignMdUnreadable?: boolean;
  };

  function fact(
    total: number,
    prov: Prov,
    status = "in_progress",
    stepSource?: "status_json" | "campaign_md" | "events" | "default",
  ): CampaignFact {
    const provenance = {
      ...prov,
      // Defaults chosen so an un-annotated fixture describes the ORDINARY
      // world: the live file was read fine and the plan document was too.
      statusJsonState: prov.statusJsonState ?? (prov.degraded ? "unreadable" : "ok"),
      campaignMdUnreadable: prov.campaignMdUnreadable ?? false,
    };
    const steps = total
      ? [
          {
            id: "S2",
            title: "Second unit",
            status,
            // The unit's own basis defaults to the campaign's; the mixed-source
            // cases below override it independently.
            statusSource: stepSource ?? provenance.statusSource,
            specPath: null,
            commit: null,
            branch: null,
            testsPassed: null,
            testsTotal: null,
          },
        ]
      : [];
    return {
      status: "ok",
      campaign: {
        slug: SLUG,
        intent: null,
        lifecycle: "active",
        branchStrategy: "serial",
        done: 0,
        total,
        steps,
        provenance,
      },
    };
  }

  it("a healthy read carries NO disclosure — the common case stays clean", () => {
    const a = buildSubIterateArtifact(fact(1, { statusSource: "status_json", degraded: false }), null);
    expect(a.summary).toBe("S2 — Second unit is running now.");
  });

  it("a DEGRADED read qualifies 'is running now' instead of asserting it", () => {
    const a = buildSubIterateArtifact(fact(1, { statusSource: "campaign_md", degraded: true }), null);
    expect(a.state).toBe("available");
    expect(a.summary).toContain("is running now.");
    // The claim is still made — but it can no longer be mistaken for live fact.
    expect(a.summary).toContain("could not be read");
    expect(a.summary).toContain("may be out of date");
  });

  it("a merely-absent status file gets a different, non-alarming sentence", () => {
    const a = buildSubIterateArtifact(
      fact(1, { statusSource: "campaign_md", degraded: false, statusJsonState: "absent" }),
      null,
    );
    expect(a.summary).toContain("no live status file");
    // Nothing failed here, so nothing may suggest a failure.
    expect(a.summary).not.toContain("could not be read");
  });

  it("names campaign.md — NOT the status file — when campaign.md is what failed", () => {
    // A single `degraded` boolean said "the live status file could not be read"
    // even when status.json was fine and campaign.md was the casualty: a false
    // statement made BY the disclosure meant to prevent one (external code
    // review, openai #4).
    const a = buildSubIterateArtifact(
      fact(1, {
        statusSource: "status_json",
        degraded: true,
        statusJsonState: "ok",
        campaignMdUnreadable: true,
      }),
      null,
    );
    expect(a.summary).toContain("plan document could not be read");
    expect(a.summary).not.toContain("live status file could not be read");
  });

  it("says the live file does not RECORD this unit, rather than that it is absent", () => {
    // status.json exists and parsed; it simply lists no row for this unit.
    // "This campaign has no live status file" would be materially false
    // (external code review, openai #5).
    const a = buildSubIterateArtifact(
      fact(
        1,
        { statusSource: "status_json", degraded: false, statusJsonState: "ok" },
        "in_progress",
        "campaign_md",
      ),
      null,
    );
    expect(a.summary).toContain("does not record this unit");
    expect(a.summary).not.toContain("no live status file");
  });

  it("zero units + a degraded read is UNAVAILABLE, not 'no units recorded yet'", () => {
    const a = buildCampaignProgressArtifact(fact(0, { statusSource: "none", degraded: true }), null);
    // The bug: a double read failure rendered as a settled, empty fact.
    expect(a.state).toBe("unavailable");
    expect(a.summary).toBeNull();
    expect(a.note).toBeTruthy();
  });

  it("zero units + a CLEAN read keeps the honest empty phrasing", () => {
    const a = buildCampaignProgressArtifact(fact(0, { statusSource: "none", degraded: false }), null);
    expect(a.state).toBe("available");
    expect(a.summary).toBe("This campaign has no units recorded yet.");
  });

  it("qualifies a unit whose OWN status the live file never mentioned", () => {
    // The mixed case: status.json names S1 (so the campaign reads `status_json`)
    // but not S2, whose status therefore comes from the plan table. A
    // campaign-level flag would vouch for S2 as live — the gap the external plan
    // review flagged (openai HIGH #5).
    const a = buildSubIterateArtifact(
      fact(1, { statusSource: "status_json", degraded: false }, "in_progress", "campaign_md"),
      null,
    );
    expect(a.summary).toContain("is running now.");
    // Sharpened by the external code review: the live file EXISTS here, it just
    // says nothing about this unit, so the disclosure must not claim it is absent.
    expect(a.summary).toContain("does not record this unit");
  });

  it("does NOT qualify a unit the live file DID name, in the same campaign", () => {
    const a = buildSubIterateArtifact(
      fact(1, { statusSource: "status_json", degraded: false }, "in_progress", "status_json"),
      null,
    );
    expect(a.summary).toBe("S2 — Second unit is running now.");
  });

  it("says an unrecorded unit's state is an assumption, not a report", () => {
    // Neither source named this unit, so `pending` is the READER's default.
    const a = buildSubIterateArtifact(
      fact(1, { statusSource: "campaign_md", degraded: false }, "pending", "default"),
      null,
    );
    expect(a.summary).toContain("has not started yet.");
    expect(a.summary).toContain("assumption rather than a reported state");
  });

  it("an events-reconstructed campaign says its records are not in this copy", () => {
    const a = buildCampaignProgressArtifact(
      fact(1, { statusSource: "events", degraded: false }, "complete"),
      "S2",
    );
    expect(a.summary).toContain("reconstructed");
  });
});
