/*
 * Spec 97 — keyboard image paste in the embedded terminal
 * (iterate-2026-10-10-terminal-image-paste-keyboard).
 *
 * Ctrl+V and Alt+V used to ignore an IMAGE on the browser clipboard (Ctrl+V
 * read text only; Alt+V made Claude read the server's empty clipboard) — only
 * right-click → Paste worked. A real clipboard image + a real key chord must
 * now POST to /paste-image.
 */
import { cleanupProject, seedProject, setActiveProject, type SeededProject } from "../helpers/fixtures";
import { test, expect, type APIRequestContext } from "@playwright/test";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";

let project: SeededProject;

const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

async function createTask(request: APIRequestContext, cwd: string): Promise<string> {
  const res = await request.post("/api/external/tasks", {
    data: { title: "97-kbd-image-paste", cwd, projectId: project.projectId },
  });
  if (!res.ok()) throw new Error(`create task: HTTP ${res.status()}`);
  return ((await res.json()) as { task: { taskId: string } }).task.taskId;
}

test.describe("Spec 97 — keyboard image paste", () => {
  test.setTimeout(120_000);
  test.use({ permissions: ["clipboard-read", "clipboard-write"] });

  test.beforeEach(async ({ page, request }) => {
    project = await seedProject(request, { name: "97-kbd-image-paste" });
    await setActiveProject(page, project.projectId);
  });
  test.afterEach(async ({ request }) => {
    await cleanupProject(request, project);
  });

  for (const chord of ["Control+V", "Alt+V"]) {
    test(`${chord} with an image on the clipboard uploads it`, { tag: ["@FR-01.28"] }, async ({ page, request }) => {
      const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "kbd-img-"));
      const taskId = await createTask(request, cwd);
      try {
        await page.goto(`/tasks/${taskId}`);
        await expect(page.getByTestId("embedded-terminal")).toHaveAttribute(
          "data-ws-ready",
          "true",
          { timeout: 10_000 },
        );
        await page.evaluate(async (b64) => {
          const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
          await navigator.clipboard.write([
            new ClipboardItem({ "image/png": new Blob([bytes], { type: "image/png" }) }),
          ]);
        }, PNG_B64);

        await page.locator(".xterm-helper-textarea").focus();
        const reqPromise = page.waitForRequest(
          (r) => r.url().includes(`/api/terminal/${taskId}/paste-image`) && r.method() === "POST",
          { timeout: 10_000 },
        );
        await page.keyboard.press(chord);
        await reqPromise;
      } finally {
        await request.delete(`/api/external/tasks/${encodeURIComponent(taskId)}`).catch(() => {});
        await fs.rm(cwd, { recursive: true, force: true }).catch(() => {});
      }
    });
  }
});
