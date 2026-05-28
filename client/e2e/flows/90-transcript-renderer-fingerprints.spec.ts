/*
 * Spec 90 — iterate-2026-05-27-transcript-renderer-scroll.
 *
 * Seeds a JSONL fixture containing the three event classes that
 * previously rendered as "Unknown event" / raw user text, and verifies
 * the BubbleTranscript renders the new surfaces end-to-end against the
 * live stack:
 *   - mode  → mode-change pill (SYSTEM_KIND: hidden by default, shown
 *             after the system toggle).
 *   - pr-link → clickable PR card with the validated href.
 *   - Stop-hook user-string → collapsed StopHookCard that expands on click.
 *   - NO bubble-unknown anywhere (the regression these fix).
 *
 * AC4 (intent-based scroll detach) is covered by the useAutoScroll unit
 * suite (12 specs) + manual browser-verify; it is not asserted here
 * because a short seeded transcript has no scroll overflow to exercise.
 */

import { test, expect } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { homedir } from "node:os";

const PROJECTS_DIR = path.join(homedir(), ".claude", "projects");
const STORAGE_KEY = "webui.transcript.showSystem";
// The TaskDetail center pane defaults to the Terminal tab (persisted under
// this key). Force Transcript so the transcript surfaces are the active,
// visible tabpanel for this spec.
const TAB_STORAGE_KEY = "webui:embedded-terminal-default-tab";

const STOP_HOOK_BODY = [
  "Stop hook feedback:",
  "================================================================",
  "  SHIPWRIGHT BLOAT GATE — Stop blocked",
  "================================================================",
  "",
  "The IRON LAW",
  "",
  "    NO COMPLETION WHILE FILES ARE GROWING UNCHECKED",
].join("\n");

test.describe("Transcript renderer fingerprints (FR-01.02)", () => {
  test("renders mode / pr-link / stop-hook surfaces, never the Unknown card", async ({
    page,
    request,
  }) => {
    await page.goto("/");
    await page.evaluate((key) => window.localStorage.removeItem(key), STORAGE_KEY);
    // Land on the Transcript tab (default is Terminal).
    await page.evaluate(
      (key) => window.localStorage.setItem(key, JSON.stringify("transcript")),
      TAB_STORAGE_KEY,
    );

    const create = await request.post("/api/external/tasks", {
      data: { title: "transcript-fingerprints-spec", cwd: "C:/tmp/transcript-fingerprints" },
    });
    const { task } = (await create.json()) as { task: { taskId: string; sessionUuid: string } };

    const encodedDir = path.join(PROJECTS_DIR, `e2e-transcript-fingerprints-${Date.now()}`);
    mkdirSync(encodedDir, { recursive: true });
    const jsonlPath = path.join(encodedDir, `${task.sessionUuid}.jsonl`);

    const lines = [
      JSON.stringify({ type: "mode", sessionId: task.sessionUuid, mode: "normal" }),
      JSON.stringify({
        type: "pr-link",
        sessionId: task.sessionUuid,
        prNumber: 78,
        prUrl: "https://github.com/svenroth-ai/shipwright-webui/pull/78",
        prRepository: "svenroth-ai/shipwright-webui",
      }),
      // Stop-hook output arrives as a user-role event with string content.
      JSON.stringify({
        type: "user",
        sessionId: task.sessionUuid,
        message: { content: STOP_HOOK_BODY },
      }),
      // A plain user message keeps the transcript non-empty while system
      // pills are hidden, and proves stop-hook detection didn't swallow it.
      JSON.stringify({
        type: "user",
        sessionId: task.sessionUuid,
        message: { content: "Thanks, looks good!" },
      }),
    ];
    writeFileSync(jsonlPath, lines.join("\n") + "\n", "utf-8");

    await page.goto(`/tasks/${task.taskId}`);

    // PR card renders with the validated href + repo/number.
    const prCard = page.getByTestId("pr-link-card");
    await expect(prCard).toBeVisible({ timeout: 5000 });
    await expect(prCard).toContainText("svenroth-ai/shipwright-webui");
    await expect(prCard).toContainText("#78");
    const anchor = page.getByTestId("pr-link-anchor");
    await expect(anchor).toHaveAttribute(
      "href",
      "https://github.com/svenroth-ai/shipwright-webui/pull/78",
    );
    await expect(anchor).toHaveAttribute("target", "_blank");

    // Stop-hook card: collapsed by default, gate name visible, body hidden.
    const stopCard = page.getByTestId("stop-hook-card");
    await expect(stopCard).toBeVisible();
    await expect(page.getByTestId("stop-hook-card-gate")).toContainText("SHIPWRIGHT BLOAT GATE");
    await expect(page.getByTestId("stop-hook-card-body")).toHaveCount(0);
    // Expand → body appears with the verbatim banner.
    await page.getByTestId("stop-hook-card-header").click();
    await expect(page.getByTestId("stop-hook-card-body")).toBeVisible();
    await expect(page.getByTestId("stop-hook-card-body")).toContainText(
      "NO COMPLETION WHILE FILES ARE GROWING UNCHECKED",
    );

    // The plain user message survived (not swallowed by the stop-hook detector).
    await expect(page.getByTestId("bubble-user")).toContainText("Thanks, looks good!");

    // The mode pill is a SYSTEM_KIND — hidden by default, no Unknown card.
    await expect(page.getByTestId("bubble-mode-change")).toHaveCount(0);
    await expect(page.getByTestId("bubble-unknown")).toHaveCount(0);

    // Toggle "show system" → the mode pill appears.
    await page.getByTestId("system-toggle").click();
    await expect(page.getByTestId("bubble-mode-change")).toBeVisible();
    await expect(page.getByTestId("bubble-mode-change")).toContainText("normal");

    // Still no Unknown card after the toggle.
    await expect(page.getByTestId("bubble-unknown")).toHaveCount(0);

    // Cleanup: restore default-hidden for subsequent specs.
    await page.evaluate((key) => window.localStorage.removeItem(key), STORAGE_KEY);
  });
});
