/*
 * 108-reminders-bridge.spec.ts — reminders campaign W1 (server bridge, surface=api via the web harness).
 *
 * Real production Hono server (isolated stack) + the REAL Shipwright reminder CLI:
 * add -> due -> snooze -> done over HTTP, the CLI's secret refusal passed through,
 * and the cross-site POST guard. Skips when the CLI or uv is not installed on the
 * machine (the bridge itself reports that as an explicit state, tested in vitest).
 */

import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { seedProject } from "../helpers/fixtures";

function gitInit(dir: string): void {
  execFileSync("git", ["init", "-q", dir]);
  execFileSync("git", ["-C", dir, "commit", "--allow-empty", "-q", "-m", "init", "--no-gpg-sign"], {
    env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" },
  });
}

test.describe("Reminders bridge (W1)", () => {
  // @covers FR-01.04
  test("add -> due -> snooze -> done through the real CLI, refusal passthrough, 415 guard", async ({ request }) => {
    const project = await seedProject(request, {});
    gitInit(project.path);
    const base = `/api/reminders/${project.projectId}`;

    const first = await request.get(`${base}/due`);
    if (first.status() === 503) {
      test.skip(true, "reminder CLI or uv is not installed on this machine");
    }
    expect(first.status()).toBe(200);
    expect(await first.json()).toMatchObject({ projectId: project.projectId, state: expect.stringMatching(/^(ok|degraded)$/), items: [] });

    const added = await request.post(`${base}/add`, {
      data: { title: "E2E renew cert", due: "2020-01-01", why: "It expires", links: [{ label: "Docs", kind: "url", ref: "https://example.com" }] },
    });
    expect(added.status()).toBe(201);
    const id = ((await added.json()) as { reminder: { id: string } }).reminder.id;

    const due = await (await request.get(`${base}/due`)).json();
    expect(due.items.map((i: { id: string }) => i.id)).toContain(id);
    expect(JSON.stringify(due)).not.toContain("reminders.jsonl");

    const all = await (await request.get("/api/reminders/due")).json();
    expect(all.projects.find((p: { projectId: string }) => p.projectId === project.projectId)).toMatchObject({ items: [expect.objectContaining({ id })] });

    expect((await request.post(`${base}/snooze`, { data: { id, until: "2999-01-01" } })).status()).toBe(200);
    expect(((await (await request.get(`${base}/due`)).json()) as { items: unknown[] }).items).toHaveLength(0);

    expect((await request.post(`${base}/done`, { data: { id } })).status()).toBe(200);
    expect((await request.post(`${base}/done`, { data: { id: "rem-00000000" } })).status()).toBe(404);

    const refused = await request.post(`${base}/add`, { data: { title: "t", due: "2030-01-01", why: "api_key=sk-abcdefghijklmnop1234 password=hunter2hunter2" } });
    expect(refused.status()).toBe(422);
    expect(((await refused.json()) as { message: string }).message).toMatch(/looks like it contains a secret/);

    const simple = await request.post(`${base}/done`, { headers: { "content-type": "text/plain" }, data: JSON.stringify({ id }) });
    expect(simple.status()).toBe(415);
  });
});
