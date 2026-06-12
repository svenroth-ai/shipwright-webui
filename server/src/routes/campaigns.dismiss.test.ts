import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, realpathSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

import { createCampaignsRoutes, type CampaignProjectMeta } from "./campaigns.js";
import {
  DismissedCampaignsStore,
  type DismissedCampaignsApi,
} from "../core/dismissed-campaigns-store.js";

// POST /api/campaigns/:projectId/:slug/{dismiss,restore} + the `dismissed`
// annotation on GET (the manual board-quittance, iterate-2026-06-12). Split out
// of campaigns.test.ts for the 300-LOC ceiling (sibling of attached-run/events).

const SEGMENTS = [".shipwright", "planning", "iterate", "campaigns"];

describe("routes/campaigns: dismiss / restore + annotation", () => {
  let workDir: string;
  let projectRoot: string;
  let store: DismissedCampaignsStore;

  beforeEach(() => {
    workDir = mkdtempSync(path.join(tmpdir(), "campaigns-dismiss-route-"));
    const proj = path.join(workDir, "project");
    mkdirSync(proj, { recursive: true });
    projectRoot = realpathSync(proj);
    store = new DismissedCampaignsStore(
      path.join(workDir, "registry", "dismissed-campaigns.json"),
    );
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  function appFor(
    projects: Record<string, CampaignProjectMeta | undefined>,
    dismissedStore: DismissedCampaignsApi = store,
  ) {
    return createCampaignsRoutes({
      getProjectById: (id) => projects[id],
      lock: async () => async () => {},
      dismissedStore,
    });
  }

  function seedDirCampaign(slug: string): void {
    const dir = path.join(projectRoot, ...SEGMENTS, slug);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path.join(dir, "status.json"),
      JSON.stringify({ status: "active", sub_iterates: [{ id: "B0", slug: "a", status: "pending" }] }),
      "utf-8",
    );
  }

  function seedEventsGhost(slug: string): void {
    // A derivedFromEvents campaign: completed sub-iterates in the tracked log,
    // NO planning dir → the exact ghost-card case (2026-06-07-tracked-campaign-status).
    writeFileSync(
      path.join(projectRoot, "shipwright_events.jsonl"),
      [
        { type: "work_completed", campaign: slug, sub_iterate_id: "S1", commit: "" },
        { type: "work_completed", campaign: slug, sub_iterate_id: "S2", commit: "" },
      ]
        .map((l) => JSON.stringify(l))
        .join("\n"),
      "utf-8",
    );
  }

  async function getCampaigns(app: ReturnType<typeof appFor>) {
    const res = await app.request("/api/campaigns/p1");
    return (await res.json()) as {
      campaigns: Array<{ slug: string; dismissed?: boolean; derivedFromEvents?: boolean }>;
    };
  }

  it("annotates dismissed:false by default", async () => {
    seedDirCampaign("2026-06-03-x");
    const body = await getCampaigns(appFor({ p1: { id: "p1", path: projectRoot } }));
    expect(body.campaigns.find((c) => c.slug === "2026-06-03-x")?.dismissed).toBe(false);
  });

  it("POST dismiss → 200, persisted in the store, GET annotates dismissed:true", async () => {
    seedDirCampaign("2026-06-03-x");
    const app = appFor({ p1: { id: "p1", path: projectRoot } });
    const res = await app.request("/api/campaigns/p1/2026-06-03-x/dismiss", { method: "POST" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ slug: "2026-06-03-x", dismissed: true });
    expect(store.isDismissed("p1", "2026-06-03-x")).toBe(true);
    const body = await getCampaigns(app);
    expect(body.campaigns.find((c) => c.slug === "2026-06-03-x")?.dismissed).toBe(true);
  });

  it("POST restore → 200, GET annotates dismissed:false again", async () => {
    seedDirCampaign("2026-06-03-x");
    const app = appFor({ p1: { id: "p1", path: projectRoot } });
    await app.request("/api/campaigns/p1/2026-06-03-x/dismiss", { method: "POST" });
    const res = await app.request("/api/campaigns/p1/2026-06-03-x/restore", { method: "POST" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ slug: "2026-06-03-x", dismissed: false });
    const body = await getCampaigns(app);
    expect(body.campaigns.find((c) => c.slug === "2026-06-03-x")?.dismissed).toBe(false);
  });

  it("dismisses a derivedFromEvents ghost with NO planning dir (the headline case)", async () => {
    const ghost = "2026-06-07-tracked-campaign-status";
    seedEventsGhost(ghost);
    const app = appFor({ p1: { id: "p1", path: projectRoot } });
    // Sanity: the ghost is present + dismissable before dismissing.
    let body = await getCampaigns(app);
    const before = body.campaigns.find((c) => c.slug === ghost);
    expect(before?.derivedFromEvents).toBe(true);
    expect(before?.dismissed).toBe(false);

    const res = await app.request(`/api/campaigns/p1/${ghost}/dismiss`, { method: "POST" });
    expect(res.status).toBe(200);
    body = await getCampaigns(app);
    expect(body.campaigns.find((c) => c.slug === ghost)?.dismissed).toBe(true);
  });

  it("404s dismiss/restore under an unknown project", async () => {
    const app = appFor({});
    expect((await app.request("/api/campaigns/nope/x/dismiss", { method: "POST" })).status).toBe(404);
    expect((await app.request("/api/campaigns/nope/x/restore", { method: "POST" })).status).toBe(404);
  });

  it("404s dismiss/restore for a synthesized project (parity with GET/start)", async () => {
    const app = appFor({ unassigned: { id: "unassigned", path: projectRoot, synthesized: true } });
    const dis = await app.request("/api/campaigns/unassigned/x/dismiss", { method: "POST" });
    expect(dis.status).toBe(404);
    expect(await dis.json()).toMatchObject({ error: "project_not_found" });
    expect(
      (await app.request("/api/campaigns/unassigned/x/restore", { method: "POST" })).status,
    ).toBe(404);
  });

  it("400s a slug containing a control character", async () => {
    const app = appFor({ p1: { id: "p1", path: projectRoot } });
    const badSlug = "bad" + String.fromCharCode(1) + "slug"; // embedded C0 control char
    const res = await app.request(`/api/campaigns/p1/${encodeURIComponent(badSlug)}/dismiss`, {
      method: "POST",
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "invalid_slug" });
  });

  it("503s when the dismissed-store lock is contended (ELOCKED)", async () => {
    const elockedStore: DismissedCampaignsApi = {
      listDismissed: () => new Set(),
      dismiss: async () => {
        throw Object.assign(new Error("locked"), { code: "ELOCKED" });
      },
      restore: async () => {},
    };
    const app = appFor({ p1: { id: "p1", path: projectRoot } }, elockedStore);
    const res = await app.request("/api/campaigns/p1/2026-06-03-x/dismiss", { method: "POST" });
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: "lock_unavailable" });
  });
});
