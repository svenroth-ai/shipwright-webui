/*
 * 107-central-data-default.spec.ts — iterate-2026-10-30-central-data-default.
 *
 * Real browser + real server: register a repo through the manual wizard with
 * the DEFAULT (data kept centrally), then drive the surfaces that used to write
 * into the repo (actions stub) and prove the repo folder only changes where
 * the USER asked (the Markdown edit), while the webui's own files landed in
 * the central data dir. A second test proves the opt-in `shared` mode and the
 * legacy "Move to user folder" migration. The isolated-stack harness points
 * HOME at a temp dir, so `os.homedir()/.shipwright-webui` IS the registry dir.
 */

import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { makeTaskCwd, cleanupCwd } from "../helpers/task-fixture";

async function listing(root: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (dir: string) => {
    for (const e of await fs.readdir(dir, { withFileTypes: true })) {
      const abs = path.join(dir, e.name);
      out.push(path.relative(root, abs));
      if (e.isDirectory()) await walk(abs);
    }
  };
  await walk(root);
  return out.sort();
}

const exists = (p: string) => fs.access(p).then(() => true, () => false);

test.describe("Central data default (iterate-2026-10-30)", () => {
  let repo = "";
  let projectId = "";

  test.beforeEach(async () => {
    repo = await makeTaskCwd("iterate-e2e-central-");
    await fs.writeFile(path.join(repo, "README.md"), "# customer repo\n");
    await fs.writeFile(path.join(repo, ".gitignore"), "node_modules\n");
  });

  test.afterEach(async ({ request }) => {
    if (projectId) await request.delete(`/api/projects/${projectId}`);
    projectId = "";
    await cleanupCwd(repo);
  });

  async function register(page: import("@playwright/test").Page, tickShared: boolean) {
    await page.goto("/projects?new=1");
    await page.getByPlaceholder("My Awesome App").fill("Customer Repo");
    await page.getByPlaceholder(/Users|home|projects/).fill(repo);
    if (tickShared) await page.getByRole("checkbox").check();
    // Info -> Stack -> Env -> Confirmation, then Create.
    for (let i = 0; i < 4; i++) await page.getByTestId("wizard-next").click();
  }

  async function findProject(request: import("@playwright/test").APIRequestContext) {
    const list = await request.get("/api/projects");
    const projects = ((await list.json()) as { data: Array<{ id: string; path: string; shared?: boolean }> }).data;
    return projects.find((p) => p.path === repo);
  }

  // @covers FR-01.03
  test("default registration keeps webui files out of the repo; repo files stay editable", async ({
    page,
    request,
  }) => {
    const before = await listing(repo);
    await register(page, false);

    await expect.poll(async () => (await findProject(request))?.id).toBeTruthy();
    const created = (await findProject(request))!;
    expect(created.shared).not.toBe(true);
    projectId = created.id;

    const stub = await request.post(`/api/projects/${projectId}/actions-stub`);
    expect(stub.ok()).toBeTruthy();
    const central = path.join(os.homedir(), ".shipwright-webui", "projects", projectId, "actions.json");
    await expect.poll(() => exists(central)).toBe(true);

    expect(await listing(repo)).toEqual(before);

    // No write protection: a Markdown edit through the webui lands in the repo.
    const fileUrl = `/api/external/projects/${projectId}/file?path=README.md`;
    const etag = (await request.get(fileUrl)).headers()["etag"];
    expect(etag).toBeTruthy();
    const put = await request.put(fileUrl, {
      data: "# changed\n",
      headers: { "content-type": "text/markdown", "if-match": etag },
    });
    expect(put.ok()).toBeTruthy();
    expect(await fs.readFile(path.join(repo, "README.md"), "utf8")).toBe("# changed\n");
  });

  // @covers FR-01.03
  test("shared mode keeps actions.json in the repo; legacy files can be moved to the user folder", async ({
    page,
    request,
  }) => {
    await register(page, true);
    await expect(page.getByText("(shared)")).toBeVisible();
    await expect.poll(async () => (await findProject(request))?.id).toBeTruthy();
    const created = (await findProject(request))!;
    expect(created.shared).toBe(true);
    projectId = created.id;

    const stub = await request.post(`/api/projects/${projectId}/actions-stub`);
    expect(stub.ok()).toBeTruthy();
    const inRepo = path.join(repo, ".shipwright-webui", "actions.json");
    await expect.poll(() => exists(inRepo)).toBe(true);

    // Switch to central: the repo copy is "legacy" and the migrate route moves it.
    const patch = await request.patch(`/api/projects/${projectId}`, { data: { shared: false } });
    expect(patch.ok()).toBeTruthy();
    const status = await request.get(`/api/projects/${projectId}/data-status`);
    expect(((await status.json()) as { data: { legacyPresent: boolean } }).data.legacyPresent).toBe(true);

    const moved = await request.post(`/api/projects/${projectId}/migrate-data`);
    expect(moved.ok()).toBeTruthy();
    const central = path.join(os.homedir(), ".shipwright-webui", "projects", projectId, "actions.json");
    expect(await exists(central)).toBe(true);
    expect(await exists(inRepo)).toBe(false);
  });
});
