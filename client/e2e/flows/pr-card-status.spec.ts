/*
 * Spec — PR card open/merged status badge (iterate-2026-05-30-pr-card-status).
 *
 * Seeds a JSONL fixture with a `pr-link` event (mirrors spec 90's harness),
 * route-mocks GET /api/external/pr-status so the result is deterministic
 * (no dependency on a live gh / network), and asserts the BubbleTranscript
 * renders the Merged badge plus the assistant-bubble geometry (AC1 + AC2).
 */

import { test, expect } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { homedir } from "node:os";

const PROJECTS_DIR = path.join(homedir(), ".claude", "projects");
// TaskDetail center pane defaults to Terminal; force Transcript so the PR card
// is the active, visible tabpanel.
const TAB_STORAGE_KEY = "webui:embedded-terminal-default-tab";

test.describe("PR card status badge (FR-01.02)", () => {
  test("renders the Merged badge + bubble geometry for a pr-link event", async ({
    page,
    request,
  }) => {
    // Deterministic status — independent of a live gh / network.
    await page.route("**/api/external/pr-status*", (route) =>
      route.fulfill({ json: { state: "merged", merged: true } }),
    );

    await page.goto("/");
    await page.evaluate(
      (key) => window.localStorage.setItem(key, JSON.stringify("transcript")),
      TAB_STORAGE_KEY,
    );

    const create = await request.post("/api/external/tasks", {
      data: { title: "pr-card-status-spec", cwd: "C:/tmp/pr-card-status" },
    });
    const { task } = (await create.json()) as {
      task: { taskId: string; sessionUuid: string };
    };

    const encodedDir = path.join(
      PROJECTS_DIR,
      `e2e-pr-card-status-${Date.now()}`,
    );
    mkdirSync(encodedDir, { recursive: true });
    const jsonlPath = path.join(encodedDir, `${task.sessionUuid}.jsonl`);
    writeFileSync(
      jsonlPath,
      JSON.stringify({
        type: "pr-link",
        sessionId: task.sessionUuid,
        prNumber: 78,
        prUrl: "https://github.com/svenroth-ai/shipwright-webui/pull/78",
        prRepository: "svenroth-ai/shipwright-webui",
      }) + "\n",
      "utf-8",
    );

    await page.goto(`/tasks/${task.taskId}`);

    const card = page.getByTestId("pr-link-card");
    await expect(card).toBeVisible({ timeout: 5000 });
    await expect(card).toContainText("#78");

    // AC2 — the Merged badge renders.
    const badge = page.getByTestId("pr-state-merged");
    await expect(badge).toBeVisible();
    await expect(badge).toHaveText("Merged");

    // AC1 — bubble parity with the assistant message bubble.
    const anchor = page.getByTestId("pr-link-anchor");
    expect(await anchor.getAttribute("class")).toContain("max-w-[90%]");
    const geom = await anchor.evaluate((el) => {
      const cs = getComputedStyle(el);
      return {
        fontSize: cs.fontSize,
        paddingTop: cs.paddingTop,
        paddingLeft: cs.paddingLeft,
        topLeftRadius: cs.borderTopLeftRadius,
        topRightRadius: cs.borderTopRightRadius,
      };
    });
    expect(geom.fontSize).toBe("14px"); // text-sm
    expect(geom.paddingTop).toBe("8px"); // py-2
    expect(geom.paddingLeft).toBe("12px"); // px-3
    expect(geom.topLeftRadius).toBe("4px"); // bubble tail
    expect(geom.topRightRadius).toBe("14px"); // bubble radius
  });
});
