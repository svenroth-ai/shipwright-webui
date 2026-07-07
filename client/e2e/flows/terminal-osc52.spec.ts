/*
 * terminal-osc52 — real-browser proof that an OSC 52 clipboard write emitted
 * by the terminal reaches the OS clipboard, and that a read request is denied
 * (iterate-2026-07-07-terminal-osc52-clipboard).
 *
 * Claude Code copies a mouse selection via OSC 52 (`ESC ] 52 ; c ; <base64>`);
 * xterm.js drops it by default, so the copy never landed and paste returned
 * the old entry. This drives a REAL xterm parser: `term.write` an OSC 52
 * escape and assert the browser clipboard received the decoded text — the same
 * path Claude exercises. (Localhost is a secure context so the copy takes the
 * navigator.clipboard fast path; the execCommand fallback for the user's real
 * non-secure http/Tailscale context is unit-covered + was validated live.)
 *
 * The OSC escape is assembled from String.fromCharCode(27/7) — literal control
 * bytes in a source file are unreliable (Write/Edit corruption).
 */
import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

async function makeTaskCwd(): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), "terminal-osc52-e2e-"));
}
async function cleanupCwd(dir: string): Promise<void> {
  for (let i = 0; i < 5; i++) {
    try {
      await fs.rm(dir, { recursive: true, force: true });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
}
async function createTask(request: APIRequestContext, cwd: string): Promise<string> {
  const res = await request.post("/api/external/tasks", {
    data: { title: "terminal-osc52-e2e", cwd },
  });
  if (!res.ok()) throw new Error(`create task: HTTP ${res.status()}`);
  const body = (await res.json()) as { task: { taskId: string } };
  return body.task.taskId;
}
async function openTerminal(page: Page, taskId: string): Promise<void> {
  await page.goto(`/tasks/${taskId}`);
  const term = page.getByTestId("embedded-terminal");
  await expect(term).toBeVisible();
  await expect(term).toHaveAttribute("data-ws-ready", "true", { timeout: 15000 });
  await page.waitForTimeout(800);
}

/** Feed an OSC 52 payload (`<Pc>;<Pd>`) into the real xterm parser. */
async function writeOsc52(page: Page, payload: string): Promise<void> {
  await page.evaluate((pd) => {
    const term = (window as unknown as { __embeddedTerminal?: { write(d: string): void } })
      .__embeddedTerminal;
    if (!term) throw new Error("no __embeddedTerminal");
    const ESC = String.fromCharCode(27);
    const BEL = String.fromCharCode(7);
    term.write(ESC + "]52;" + pd + BEL); // ESC ] 52 ; <Pc>;<Pd> BEL
  }, payload);
}

test.describe("iterate-2026-07-07 — OSC 52 clipboard relay", () => {
  test("an OSC 52 write from the terminal lands on the OS clipboard", async ({
    page,
    request,
  }) => {
    const cwd = await makeTaskCwd();
    const taskId = await createTask(request, cwd);
    try {
      await openTerminal(page, taskId);
      await page.evaluate(() => navigator.clipboard.writeText("STALE-BEFORE"));

      const marker = "osc52-payload-café-🚀-1234";
      const b64 = await page.evaluate(
        (m) => btoa(unescape(encodeURIComponent(m))),
        marker,
      );
      await writeOsc52(page, "c;" + b64);

      await expect
        .poll(() => page.evaluate(() => navigator.clipboard.readText()), {
          timeout: 5000,
        })
        .toBe(marker);
    } finally {
      await cleanupCwd(cwd);
    }
  });

  test("an OSC 52 READ request does NOT alter the clipboard (deny — no leak)", async ({
    page,
    request,
  }) => {
    const cwd = await makeTaskCwd();
    const taskId = await createTask(request, cwd);
    try {
      await openTerminal(page, taskId);
      await page.evaluate(() => navigator.clipboard.writeText("SECRET-KEEP"));

      // `ESC ] 52 ; c ; ?` is a read request — the handler must consume it
      // without touching (or leaking) the clipboard.
      await writeOsc52(page, "c;?");
      await page.waitForTimeout(500);

      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
        "SECRET-KEEP",
      );
    } finally {
      await cleanupCwd(cwd);
    }
  });
});
