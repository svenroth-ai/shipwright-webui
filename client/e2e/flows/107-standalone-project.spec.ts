/*
 * 107-standalone-project.spec.ts — iterate-2026-10-29-standalone-mode.
 *
 * Real browser + real server: register a repo as STANDALONE through the
 * manual-registration wizard, then drive the surfaces that used to write into
 * the repo (actions stub, a repo-writing route) and prove the repo folder is
 * byte-for-byte what it was, while the webui's own files landed in the central
 * data dir. The isolated-stack harness points HOME at a temp dir, so
 * `os.homedir()/.shipwright-webui` IS the server's registry dir here.
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

test.describe("Standalone project (iterate-2026-10-29)", () => {
  let repo = "";
  let projectId = "";

  test.beforeEach(async () => {
    repo = await makeTaskCwd("iterate-e2e-standalone-");
    await fs.writeFile(path.join(repo, "README.md"), "# customer repo\n");
    await fs.writeFile(path.join(repo, ".gitignore"), "node_modules\n");
  });

  test.afterEach(async ({ request }) => {
    if (projectId) await request.delete(`/api/projects/${projectId}`);
    await cleanupCwd(repo);
  });

  // @covers FR-01.03
  test("registering via the wizard leaves the repo untouched and uses the central data dir", async ({
    page,
    request,
  }) => {
    const before = await listing(repo);

    await page.goto("/projects?new=1");
    await page.getByPlaceholder("My Awesome App").fill("Customer Repo");
    await page.getByPlaceholder(/Users|home|projects/).fill(repo);
    await page.getByRole("checkbox").check();
    // Info -> Stack -> Env -> Confirmation, then Create.
    for (let i = 0; i < 4; i++) await page.getByTestId("wizard-next").click();

    await expect(page.getByText("(standalone)")).toBeVisible();

    const list = await request.get("/api/projects");
    const projects = ((await list.json()) as { data: Array<{ id: string; path: string; standalone?: boolean }> }).data;
    const created = projects.find((p) => p.path === repo);
    expect(created?.standalone).toBe(true);
    projectId = created!.id;

    // The wizard's custom-workflow stub call: must land centrally, not in the repo.
    const stub = await request.post(`/api/projects/${projectId}/actions-stub`);
    expect(stub.ok()).toBeTruthy();
    const central = path.join(os.homedir(), ".shipwright-webui", "projects", projectId, "actions.json");
    await expect.poll(async () => fs.access(central).then(() => true, () => false)).toBe(true);

    // A repo-writing surface is refused outright.
    const put = await request.put(`/api/external/projects/${projectId}/file?path=README.md`, {
      data: "# changed\n",
      headers: { "content-type": "text/markdown" },
    });
    expect(put.status()).toBe(403);
    expect(((await put.json()) as { error: string }).error).toBe("standalone_project_read_only");

    expect(await listing(repo)).toEqual(before);
    expect(await fs.readFile(path.join(repo, "README.md"), "utf8")).toBe("# customer repo\n");
  });
});
