/*
 * Campaign fixtures. iterate-2026-07-10-harness-hardening (A00).
 *
 * The campaign specs assert on specific campaign cards (`campaign-lane-card-<slug>`)
 * but never CREATED any — they assumed a "fixture project" already sitting on the
 * developer's disk with those campaign directories in it. On a CI runner there is no
 * such project, so the lane never renders and every assertion fails.
 *
 * The server reads campaigns straight off the filesystem
 * (`core/campaign-paths.ts` → `<project>/.shipwright/planning/iterate/campaigns/`,
 * then `core/campaign-store.ts buildCampaign`, which accepts a directory carrying
 * `status.json` and/or `campaign.md`). So a fixture just writes those files into the
 * seeded project's own temp dir — the same read path production uses, no shortcut.
 */

import fs from "node:fs";
import path from "node:path";

/** Mirrors SUBDIR_SEGMENTS in server/src/core/campaign-paths.ts. */
const CAMPAIGNS_SEGMENTS = [".shipwright", "planning", "iterate", "campaigns"];

/** Campaign lifecycle, producer-owned (see the campaign-lifecycle decision). */
export type CampaignLifecycle = "draft" | "active" | "complete" | "failed";

/**
 * One sub-iterate row. `id` + `slug` are load-bearing: the server resolves each
 * sub-iterate's spec file as `<campaignDir>/sub-iterates/<id>-<slug>.md`
 * (campaign-store.ts), and that path is what the lane's Copy-launch button emits.
 */
export interface SubIterateSeed {
  id: string;
  slug: string;
  status?: "complete" | "pending" | "in_progress" | "failed";
  title?: string;
}

export interface CampaignSeed {
  /** Directory name == the slug the board renders as `campaign-lane-card-<slug>`. */
  slug: string;
  title?: string;
  /** Omit to seed a LEGACY campaign (no lifecycle → consumer falls back to done/total). */
  status?: CampaignLifecycle;
  /** Explicit sub-iterates (with real spec files). Takes precedence over total/done. */
  subIterates?: SubIterateSeed[];
  /** Shorthand: `total` sub-iterates, the first `done` of them complete. */
  total?: number;
  done?: number;
}

export function campaignsDir(projectPath: string): string {
  return path.join(projectPath, ...CAMPAIGNS_SEGMENTS);
}

/**
 * Write one campaign into the seeded project. Returns its directory.
 *
 * `status.json` alone is sufficient for `buildCampaign` (it bails only when BOTH
 * status.json and campaign.md are absent), so that is what we write — plus a
 * campaign.md so the card has a human title.
 */
export function seedCampaign(projectPath: string, seed: CampaignSeed): string {
  const dir = path.join(campaignsDir(projectPath), seed.slug);
  fs.mkdirSync(dir, { recursive: true });

  const total = seed.total ?? 2;
  const done = seed.done ?? 0;
  const subs: SubIterateSeed[] =
    seed.subIterates ??
    Array.from({ length: total }, (_, i) => ({
      id: `S${i + 1}`,
      slug: `step-${i + 1}`,
      status: i < done ? "complete" : "pending",
    }));

  // The spec FILE must exist: the server resolves it as
  // `<campaignDir>/sub-iterates/<id>-<slug>.md`, and that path is what the lane's
  // Copy-launch button puts on the clipboard. A missing file means a card that
  // renders but cannot be launched — which is what the specs assert against.
  const subDir = path.join(dir, "sub-iterates");
  fs.mkdirSync(subDir, { recursive: true });
  for (const s of subs) {
    fs.writeFileSync(
      path.join(subDir, `${s.id}-${s.slug}.md`),
      `# ${s.id} — ${s.title ?? s.slug}\n\nSeeded by the E2E campaign fixture.\n`,
      "utf-8",
    );
  }

  const statusJson: Record<string, unknown> = {
    sub_iterates: subs.map((s) => ({
      id: s.id,
      slug: s.slug,
      status: s.status ?? "pending",
    })),
  };
  // A LEGACY campaign is one with no lifecycle at all — the board must still show
  // it (that back-compat path is what `campaign-status-filter` guards).
  if (seed.status) statusJson.status = seed.status;

  fs.writeFileSync(
    path.join(dir, "status.json"),
    JSON.stringify(statusJson, null, 2),
    "utf-8",
  );
  fs.writeFileSync(
    path.join(dir, "campaign.md"),
    `# ${seed.title ?? seed.slug}\n\nSeeded by the E2E campaign fixture.\n`,
    "utf-8",
  );
  return dir;
}

/** Seed several campaigns at once. */
export function seedCampaigns(projectPath: string, seeds: CampaignSeed[]): void {
  for (const s of seeds) seedCampaign(projectPath, s);
}

/**
 * Seed the TRACKED `<projectRoot>/shipwright_events.jsonl`.
 *
 * A campaign can exist with NO directory skeleton at all: `core/campaign-events.ts`
 * synthesizes a `derivedFromEvents` campaign purely from `work_completed` events
 * stamped with a top-level `campaign` + `sub_iterate_id`, so the board still shows
 * progress for work that was done without a checked-in campaign folder. That is a
 * separate read path from `seedCampaign()` above, and `campaign-events-projection`
 * exists to guard it — so the fixture must NOT also write a campaign dir.
 */
export function seedEventsJsonl(
  projectPath: string,
  events: Array<{ campaign: string; sub_iterate_id: string; [k: string]: unknown }>,
): string {
  const file = path.join(projectPath, "shipwright_events.jsonl");
  // The discriminator is `type`, not `event` (core/campaign-events.ts:60) — get this
  // wrong and the row is silently ignored, so the lane simply never renders.
  const rows = events.map((e) =>
    JSON.stringify({
      type: "work_completed",
      timestamp: new Date().toISOString(),
      ...e,
    }),
  );
  fs.writeFileSync(file, rows.join("\n") + "\n", "utf-8");
  return file;
}
