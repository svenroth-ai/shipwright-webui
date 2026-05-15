/*
 * Spec — inbox-awaiting-user (iterate 2026-05-15).
 *
 * The Inbox now surfaces plain-text "how should I proceed?" questions, not
 * only `AskUserQuestion` tool_use blocks. Seed a JSONL whose latest turn is
 * an assistant text message ending with "?" (no tool_use, no reply after
 * it); assert it surfaces on /inbox as a `text_question` card. Appending a
 * `user` reply event clears the card — auto-clear, no dismiss action.
 *
 * Mirrors the seeding pattern of spec 33 (Inbox pending). Requires the real
 * dev stack (Hono :3847 + Vite :5173).
 */

import { test, expect } from "@playwright/test";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { homedir } from "node:os";

const PROJECTS_DIR = path.join(homedir(), ".claude", "projects");

test.describe("Inbox awaiting-user (plain-text question)", () => {
  test("surfaces a plain-text question + auto-clears on user reply", async ({
    page,
    request,
  }) => {
    // Unique ids per run so the persistent sdk-sessions store + the JSONL
    // event uuid (= the card's questionId) don't collide across runs.
    const stamp = Date.now();
    const questionUuid = `e2e-q-${stamp}`;

    const create = await request.post("/api/external/tasks", {
      data: { title: "inbox-awaiting-user", cwd: "C:/tmp/inbox-awaiting-user" },
    });
    const { task } = (await create.json()) as {
      task: { taskId: string; sessionUuid: string };
    };

    const encodedDir = path.join(PROJECTS_DIR, `e2e-inbox-awaiting-${stamp}`);
    mkdirSync(encodedDir, { recursive: true });
    const jsonlPath = path.join(encodedDir, `${task.sessionUuid}.jsonl`);

    // Latest turn: a plain-text assistant question. No tool_use block — the
    // shape the embedded-terminal TUI produces for "how should I proceed?".
    const assistantTurn =
      JSON.stringify({
        type: "assistant",
        uuid: questionUuid,
        sessionId: task.sessionUuid,
        message: {
          content: [
            {
              type: "text",
              text: "I can take approach A or approach B. Which would you like?",
            },
          ],
        },
      }) + "\n";
    writeFileSync(jsonlPath, assistantTurn, "utf-8");

    await page.goto("/inbox");
    await expect(page.getByTestId("inbox-page")).toBeVisible();

    // Inbox derivation walks every persisted task; with a long-lived
    // sdk-sessions store the response can take several seconds. Generous
    // timeout so the assertion is not coupled to fixture accumulation.
    const card = page.getByTestId(`inbox-card-${questionUuid}`);
    await expect(card).toBeVisible({ timeout: 25_000 });
    await expect(
      page.getByTestId(`inbox-question-text-${questionUuid}`),
    ).toContainText("Which would you like?");

    // text_question cards are read-only — no Answer / dismiss CTA.
    await expect(card.locator("button")).toHaveCount(0);

    // The user replies in the terminal — a `user` event lands after the
    // turn. The next inbox derivation must drop the card (auto-clear).
    const reply =
      JSON.stringify({
        type: "user",
        uuid: `e2e-r-${stamp}`,
        sessionId: task.sessionUuid,
        message: { content: "Let's go with approach A." },
      }) + "\n";
    appendFileSync(jsonlPath, reply, "utf-8");

    await expect(card).toHaveCount(0, { timeout: 25_000 });
  });

  test("surfaces a numbered option-list question (no trailing '?')", async ({
    page,
    request,
  }) => {
    // AC-2 — a turn-ended assistant message presenting an enumerated option
    // list is surfaced even when the text does not end with "?".
    const stamp = Date.now();
    const questionUuid = `e2e-ql-${stamp}`;

    const create = await request.post("/api/external/tasks", {
      data: {
        title: "inbox-awaiting-user-list",
        cwd: "C:/tmp/inbox-awaiting-user-list",
      },
    });
    const { task } = (await create.json()) as {
      task: { taskId: string; sessionUuid: string };
    };

    const encodedDir = path.join(PROJECTS_DIR, `e2e-inbox-awaiting-ql-${stamp}`);
    mkdirSync(encodedDir, { recursive: true });
    const jsonlPath = path.join(encodedDir, `${task.sessionUuid}.jsonl`);

    const assistantTurn =
      JSON.stringify({
        type: "assistant",
        uuid: questionUuid,
        sessionId: task.sessionUuid,
        message: {
          content: [
            {
              type: "text",
              text: [
                "Here are three ways forward:",
                "1. Refactor the parser first",
                "2. Add a caching layer",
                "3. Ship the current behavior as-is",
              ].join("\n"),
            },
          ],
        },
      }) + "\n";
    writeFileSync(jsonlPath, assistantTurn, "utf-8");

    await page.goto("/inbox");
    await expect(page.getByTestId("inbox-page")).toBeVisible();

    const card = page.getByTestId(`inbox-card-${questionUuid}`);
    await expect(card).toBeVisible({ timeout: 25_000 });
    await expect(
      page.getByTestId(`inbox-question-text-${questionUuid}`),
    ).toContainText("Refactor the parser first");
  });
});
