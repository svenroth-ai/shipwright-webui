/*
 * external/launch/__tests__/campaign-branch.test.ts — POST /launch with
 * `{ campaignSlug }` (FR-01.34). The campaign branch builds the autonomous
 * campaign launch command server-side; the client only ever sends a validated
 * slug (Architecture rule 1 / regression guard #19 — command built EXCLUSIVELY
 * by core/launcher.ts).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { createLaunchRouter } from "../routes.js";
import {
  SdkSessionsStore,
  type SdkSessionsStoreDeps,
} from "../../../core/sdk-sessions-store.js";

function inMemoryDeps(): SdkSessionsStoreDeps {
  const files = new Map<string, string>();
  const existing = new Set<string>();
  return {
    readFile: async (p) => {
      if (!files.has(p)) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      return files.get(p)!;
    },
    writeFile: async (p, data) => {
      files.set(p, data);
      existing.add(p);
    },
    existsSync: (p) => existing.has(p),
    mkdirSync: (p) => {
      existing.add(p);
    },
    ensureFile: (p) => {
      if (!files.has(p)) files.set(p, "");
      existing.add(p);
    },
  };
}

const SLUG = "2026-06-02-hook-consolidation";

describe("launch campaign branch — POST /launch { campaignSlug }", () => {
  let projectRoot: string;
  let store: SdkSessionsStore;
  let app: Hono;
  let taskId: string;

  beforeEach(async () => {
    projectRoot = mkdtempSync(path.join(tmpdir(), "campaign-launch-"));
    // Seed a real campaign dir so the existence guard passes.
    mkdirSync(
      path.join(projectRoot, ".shipwright", "planning", "iterate", "campaigns", SLUG),
      { recursive: true },
    );
    store = new SdkSessionsStore("/store/sdk-sessions.json", inMemoryDeps());
    await store.load();
    const t = store.create({
      title: "campaign: " + SLUG,
      cwd: projectRoot,
      pluginDirs: [],
      projectId: "p-1",
    });
    taskId = t.taskId;
    app = new Hono();
    app.route(
      "/",
      createLaunchRouter({
        store,
        ptyManager: { get: () => undefined },
        getProjectById: (id) =>
          id === "p-1" ? { id: "p-1", name: "p1", path: projectRoot } : undefined,
        runConfigReader: async () => ({ status: "missing" }),
      }),
    );
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  async function launch(body: Record<string, unknown>) {
    const res = await app.request(`/api/external/tasks/${taskId}/launch`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return { res, json: (await res.json()) as Record<string, unknown> };
  }

  it("AC-1: builds /shipwright-iterate --campaign <slug> --autonomous as one positional, no --resume", async () => {
    const { res, json } = await launch({ campaignSlug: SLUG, dryRun: true });
    expect(res.status).toBe(200);
    const cmds = json.commands as { powershell: string; cmd: string; posix: string };
    const expectedArg = `/shipwright-iterate --campaign ${SLUG} --autonomous`;
    // POSIX: single-quoted whole positional.
    expect(cmds.posix).toContain(`'${expectedArg}'`);
    expect(cmds.posix).toContain("--session-id");
    expect(cmds.posix).toContain("--add-dir");
    expect(cmds.posix).not.toContain("--resume");
    // pwsh single-quoted, cmd double-quoted.
    expect(cmds.powershell).toContain(`'${expectedArg}'`);
    expect(cmds.cmd).toContain(`"${expectedArg}"`);
  });

  it("AC-2: rejects shell-/path-hostile slugs with 400 invalid_campaign_slug", async () => {
    const bad = [
      "has space",
      "x --dangerous-flag",
      'quote"inside',
      "back`tick",
      "semi;colon",
      "../escape",
      "a/b",
      "a\\b",
      "x".repeat(129),
    ];
    for (const slug of bad) {
      const { res, json } = await launch({ campaignSlug: slug, dryRun: true });
      expect(res.status, `slug=${JSON.stringify(slug)}`).toBe(400);
      expect(json.error).toBe("invalid_campaign_slug");
    }
  });

  it("treats an empty/whitespace campaignSlug as absent (falls through to a normal launch)", async () => {
    const { res, json } = await launch({ campaignSlug: "   ", dryRun: true });
    expect(res.status).toBe(200);
    // Legacy fallback emits no slash command — definitely not the campaign one.
    const cmds = json.commands as { posix: string };
    expect(cmds.posix).not.toContain("--campaign");
  });

  it("AC-3: 400 campaign_not_found when the slug has no matching campaign dir", async () => {
    const { res, json } = await launch({ campaignSlug: "2099-01-01-nope", dryRun: true });
    expect(res.status).toBe(400);
    expect(json.error).toBe("campaign_not_found");
  });

  it("AC-4: 400 mixed_launch_intents when campaignSlug + actionId", async () => {
    const { res, json } = await launch({ campaignSlug: SLUG, actionId: "new-plain" });
    expect(res.status).toBe(400);
    expect(json.error).toBe("mixed_launch_intents");
  });

  it("AC-4: 400 mixed_launch_intents when campaignSlug + phaseTaskRef", async () => {
    const { res, json } = await launch({
      campaignSlug: SLUG,
      phaseTaskRef: { phaseTaskId: "ptk-1234" },
    });
    expect(res.status).toBe(400);
    expect(json.error).toBe("mixed_launch_intents");
  });

  it("persists awaiting_external_start + launchedAt on a real (non-dryRun) launch", async () => {
    const { res } = await launch({ campaignSlug: SLUG });
    expect(res.status).toBe(200);
    const t = store.get(taskId)!;
    expect(t.state).toBe("awaiting_external_start");
    expect(typeof t.launchedAt).toBe("string");
  });
});
