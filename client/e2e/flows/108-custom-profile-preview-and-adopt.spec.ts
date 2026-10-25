/**
 * @covers FR-01.75
 * Preview for a project that uses its OWN stack profile, and the live Profile row
 * on the Adopt screen — real browser, real resolver CLI, real analyzer, a real
 * dev server.
 *
 * Needs (set by whoever runs the suite; the spec skips with a reason without them):
 *   SHIPWRIGHT_RESOLVE_PROFILE_SCRIPT   absolute path to resolve_profile.py
 *   SHIPWRIGHT_ANALYZE_CODEBASE_SCRIPT  absolute path to the adopt plugin's analyze_codebase.py
 * The isolated stack runs with an ephemeral HOME that has no plugin cache, so both
 * are passed explicitly instead of guessed.
 */
import { test, expect } from "@playwright/test";
import { existsSync } from "node:fs";
import path from "node:path";

import { apiUrl } from "../helpers/env";
import { cleanupProject, seedProject, setActiveProject, type SeededProject } from "../helpers/fixtures";

const resolver = process.env.SHIPWRIGHT_RESOLVE_PROFILE_SCRIPT;
const analyzer = process.env.SHIPWRIGHT_ANALYZE_CODEBASE_SCRIPT;

const PORT = 41000 + Math.floor(Math.random() * 18000);
const DEV_SERVER = `require("http").createServer((q, s) => s.end("e2e-preview-ok")).listen(${PORT}, "127.0.0.1");\n`;

const profileFile = (name: string, dev_server: unknown) =>
  JSON.stringify({ name, schema_version: 1, description: "E2E", stack: { frontend: "vite" }, dev_server });

let seeded: SeededProject[] = [];
async function project(request: Parameters<typeof seedProject>[0], name: string, profile: string, files: Record<string, string>) {
  const p = await seedProject(request, { name, profile, adopted: true, files });
  seeded.push(p);
  return p;
}
async function previewOf(request: Parameters<typeof seedProject>[0], id: string) {
  const r = await request.get(apiUrl(`/api/external/projects/${id}/actions`));
  expect(r.ok()).toBeTruthy();
  return ((await r.json()) as { preview: { enabled: boolean; port: number | null } }).preview;
}

// @covers FR-01.75
test.describe("Custom profile Preview + live Adopt profile", () => {
  // @covers FR-01.75
  test.skip(!resolver || !analyzer, "SHIPWRIGHT_RESOLVE_PROFILE_SCRIPT / SHIPWRIGHT_ANALYZE_CODEBASE_SCRIPT not set");

  // @covers FR-01.75
  test.afterEach(async ({ request }) => {
    for (const p of seeded) await cleanupProject(request, p);
    seeded = [];
  });

  // @covers FR-01.75
  test("a project's own profile shows the Preview button and starts a real dev server", async ({ page, request, context }) => {
    const p = await project(request, "108-preview", "e2e-preview", {
      "server.js": DEV_SERVER,
      ".shipwright/profiles/e2e-preview.json": profileFile("e2e-preview", { command: "node server.js", port: PORT, ready_path: "/", ready_timeout_seconds: 30 }),
    });
    expect(await previewOf(request, p.projectId)).toMatchObject({ enabled: true, port: PORT });

    await setActiveProject(page, p.projectId);
    await page.goto("/");
    const button = page.getByTestId("preview-button");
    await expect(button).toBeVisible();

    const popup = context.waitForEvent("page");
    await button.click();
    const opened = await popup;
    expect(opened.url()).toContain(String(PORT));
    // the dev server really answers - not just "a URL was returned"
    const body = await request.get(opened.url());
    expect(body.ok()).toBeTruthy();
    expect(await body.text()).toBe("e2e-preview-ok");
  });

  // @covers FR-01.75
  test("a broken profile, or one that tries to run a repo program, gets no Preview", async ({ request }) => {
    const broken = await project(request, "108-broken", "e2e-broken", {
      ".shipwright/profiles/e2e-broken.json": '{"name":"e2e-broken",',
    });
    const evil = await project(request, "108-evil", "e2e-evil", {
      ".shipwright/profiles/e2e-evil.json": profileFile("e2e-evil", { command: "./evil.js", port: PORT + 1 }),
    });
    const inline = await project(request, "108-inline", "e2e-inline", {
      ".shipwright/profiles/e2e-inline.json": profileFile("e2e-inline", { command: "node -e process.exit(0)", port: PORT + 2 }),
    });
    for (const p of [broken, evil, inline]) {
      expect((await previewOf(request, p.projectId)).enabled, p.name).toBe(false);
      const spawn = await request.post(apiUrl(`/api/external/projects/${p.projectId}/preview`));
      expect(spawn.status(), p.name).toBe(400);
      expect(((await spawn.json()) as { error: string }).error).toBe("preview_profile_invalid");
    }
  });

  // @covers FR-01.75
  test("a bundled-profile project keeps working with the resolver in play", async ({ request }) => {
    const p = await project(request, "108-bundled", "vite-hono", {});
    const preview = await previewOf(request, p.projectId);
    expect(typeof preview.enabled).toBe("boolean");
  });

  // @covers FR-01.75
  test("Adopt screen reads the repo's profile live and shows the discovery warning", async ({ page, request }) => {
    const p = await project(request, "108-adopt", "custom", {
      "package.json": JSON.stringify({ name: "x", dependencies: { react: "18", vite: "5" } }),
      ".shipwright/profiles/e2e-adopt-broken.json": '{"name":"e2e-adopt-broken",',
    });
    await page.goto("/wizard");
    await page.getByTestId("wizard-door-adopt").click();
    await page.getByTestId("wizard-repo-input").fill(p.path);
    await page.getByTestId("wizard-repo-go").click();
    await expect(page.getByTestId("wizard-adopt-result")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("wizard-adopt-profile-live")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("wizard-adopt-profile-warnings")).toContainText("e2e-adopt-broken");
    await expect(page.getByTestId("wizard-adopt-stub-note")).toContainText("Profile row is read live");
    // looking at the repo wrote nothing into it
    expect(existsSync(path.join(p.path, ".shipwright", "adopt"))).toBe(false);
  });
});
