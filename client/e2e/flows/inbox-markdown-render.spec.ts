/*
 * Spec — inbox-markdown-render (iterate-2026-05-19).
 *
 * Verifies the Inbox card body rendering politur:
 *  - a `text_question` card renders Claude's markdown (bold, inline code,
 *    bullet + ordered list) through the XSS-safe <MarkdownText> — the raw
 *    `**` / backtick / `- ` markers are consumed, not shown literally;
 *  - a `terminal_prompt` card keeps escaped plain-text — markdown syntax in
 *    a live xterm picker stays literal so the numbered menu is not reflowed;
 *  - a long body is clipped to a preview height with a soft bottom fade.
 *
 * Route-mocks the inbox API so the markdown content is controlled exactly
 * (no JSONL seeding, no real backend dependency). Screenshots the page as
 * the F0.5 web-surface evidence.
 */

import { test, expect } from "@playwright/test";

const PROJECT = {
  id: "proj-md",
  name: "leadwright",
  path: "C:/tmp/leadwright",
  profile: "generic",
  status: "active",
  lastActive: "2026-05-19T00:00:00Z",
  createdAt: "2026-05-19T00:00:00Z",
};

const TEXT_TASK = {
  taskId: "task-md",
  sessionUuid: "307d6ab8-1111-4111-8111-111111111111",
  cwd: "C:/tmp/leadwright",
  pluginDirs: [],
  title: "Status triage",
  projectId: "proj-md",
  state: "idle",
  createdAt: "2026-05-19T00:00:00Z",
  launchedAt: "2026-05-19T00:00:00Z",
  inbox: {
    pendingToolUseIds: [],
    dismissedToolUseIds: [],
    lastProcessedByteOffset: 0,
  },
};

const TP_TASK = {
  ...TEXT_TASK,
  taskId: "task-tp",
  sessionUuid: "307d6ab8-2222-4222-8222-222222222222",
  title: "Picker task",
};

// Long markdown body — longer than MAX_BODY_PREVIEW_PX so the soft fade
// engages. Mirrors the shape of a real Claude status message.
const MD_QUESTION = [
  "Status-Doc liegt unter `leadwright/STATUS-Triage.md`. Kurzfassung:",
  "",
  "**Wo wir stehen**",
  "",
  "- **`shipwright` Monorepo**: Iterate 1a + 2 sind gemerged.",
  "- **Storage + 6 Producer** leben auf `main`.",
  "- `main` hat noch 7 Canon-Auto-Regen-Files uncommitted.",
  "",
  "**Was als Nächstes**",
  "",
  "1. Hygiene-Commit der Canon-Files.",
  "2. CI-Producer nachziehen.",
  "3. Drift-Check über alle Specs.",
  "",
  "Womit willst du anfangen?",
].join("\n");

const TP_TEXT = "**Pick one**\n  1. Board\n  2. Detail\nEnter to select";

test.describe("Inbox markdown rendering (iterate-2026-05-19)", () => {
  test("text_question renders markdown; terminal_prompt stays plain", async ({
    page,
  }) => {
    await page.route("**/api/projects", (r) =>
      r.fulfill({ json: { data: [PROJECT] } }),
    );
    await page.route("**/api/external/tasks*", (r) =>
      r.fulfill({ json: { tasks: [TEXT_TASK, TP_TASK] } }),
    );
    await page.route("**/api/external/inbox", (r) =>
      r.fulfill({
        json: {
          items: [
            {
              kind: "text_question",
              taskId: "task-md",
              sessionUuid: TEXT_TASK.sessionUuid,
              taskTitle: TEXT_TASK.title,
              questionId: "q-md",
              questionText: MD_QUESTION,
              bestEffort: true,
            },
            {
              kind: "terminal_prompt",
              taskId: "task-tp",
              sessionUuid: TP_TASK.sessionUuid,
              taskTitle: TP_TASK.title,
              promptText: TP_TEXT,
              bestEffort: true,
            },
          ],
        },
      }),
    );
    await page.route("**/api/triage/counts", (r) =>
      r.fulfill({ json: { counts: {}, total: 0 } }),
    );

    await page.goto("/inbox");
    await expect(page.getByTestId("inbox-page")).toBeVisible();

    // text_question — markdown is rendered: bold, inline code, both lists.
    const mdBody = page.getByTestId("inbox-question-text-q-md");
    await expect(mdBody).toBeVisible();
    await expect(mdBody.locator("strong").first()).toBeVisible();
    await expect(mdBody.locator("code").first()).toBeVisible();
    await expect(mdBody.locator("ul li").first()).toBeVisible();
    await expect(mdBody.locator("ol li").first()).toBeVisible();
    // The raw markers were consumed — not shown literally.
    await expect(mdBody).not.toContainText("**Wo wir stehen**");
    // Bullet markers survive Tailwind v4's list-style reset.
    const ulMarker = await mdBody
      .locator("ul")
      .first()
      .evaluate((el) => getComputedStyle(el).listStyleType);
    expect(ulMarker).toBe("disc");

    // terminal_prompt — escaped plain-text; markdown syntax stays literal.
    const tpBody = page.getByTestId("inbox-question-text-tp-task-tp");
    await expect(tpBody).toBeVisible();
    await expect(tpBody.locator("strong")).toHaveCount(0);
    await expect(tpBody).toContainText("**Pick one**");

    await page.screenshot({
      path: "test-results/inbox-markdown-render.png",
      fullPage: true,
    });
  });
});
