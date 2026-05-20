/*
 * Spec — triage-fix-now (iterate-2026-05-20-triage-launch-surface-webui).
 *
 * AC: the Triage tab shows the launchPayload (Iterate-A producer field)
 * in a `<pre><code>` block on each open item with a renderable payload,
 * and the Fix-now button copies the cleaned payload to the clipboard
 * with a transient confirmation. This is the F0.5 web-surface gate the
 * unit tests cannot satisfy (they stub `copyText` directly).
 *
 * Strategy:
 *  1. Create a real on-disk directory `<tmp>/triage-fix-now-{stamp}`.
 *  2. Write `.shipwright/triage.jsonl` with a non-empty launchPayload
 *     item BEFORE registering the project with the WebUI — that way
 *     the 5 s mtime-keyed read cache in `core/triage-store.ts` cannot
 *     return a stale-empty array.
 *  3. POST /api/projects to register it with the running stack.
 *  4. Grant clipboard permissions, navigate to /triage, click the
 *     item, then the Fix-now button. Assert (a) confirmation banner
 *     visible, (b) `navigator.clipboard.readText()` returns the cleaned
 *     payload.
 *  5. Cleanup: DELETE the project + rm the tmp dir.
 *
 * The test does NOT touch the user's real `~/.shipwright-webui` files —
 * the project entry it adds is removed in afterEach.
 */

import { test, expect } from "@playwright/test";
import { mkdirSync, rmSync, writeFileSync, mkdtempSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

// Raw payload contains ESC (\x1b) + DEL (\x7f) so the spec actually
// proves AC-6's "copies the cleaned (control-stripped) payload"
// requirement. A payload without control chars would let a broken
// implementation that copied the raw bytes still pass. External
// review LOW #6.
const RAW_LAUNCH_PAYLOAD =
  "/iterate fix code-scanning findings\x1b\n\nRepo: example/repo\nFindings: 3\x7f\nhttps://example.test/security/code-scanning";
// What the operator sees + what the clipboard receives — control
// chars stripped per the canonical Python allow-list.
const CLEANED_LAUNCH_PAYLOAD =
  "/iterate fix code-scanning findings\n\nRepo: example/repo\nFindings: 3\nhttps://example.test/security/code-scanning";

test.describe("Triage tab — Fix-now CTA (iterate-2026-05-20-triage-launch-surface-webui)", () => {
  let tmpDir = "";
  let projectId = "";

  test.beforeEach(async ({ request }) => {
    tmpDir = mkdtempSync(path.join(tmpdir(), "triage-fix-now-"));
    const triageDir = path.join(tmpDir, ".shipwright");
    mkdirSync(triageDir, { recursive: true });
    writeFileSync(
      path.join(triageDir, "triage.jsonl"),
      [
        JSON.stringify({
          v: 1,
          schema: "triage",
          created: "2026-05-20T08:00:00Z",
        }),
        JSON.stringify({
          event: "append",
          id: "trg-e2efix01",
          ts: "2026-05-20T08:01:00Z",
          originalTs: "2026-05-20T08:01:00Z",
          source: "github",
          severity: "high",
          kind: "bug",
          title: "E2E launch-payload item",
          detail: "Detail body for the E2E spec",
          evidencePath: null,
          runId: null,
          commit: null,
          dedupKey: "e2e:fix-now",
          launchPayload: RAW_LAUNCH_PAYLOAD,
          status: "triage",
          suggestedPriority: "P1",
          suggestedDomain: "security",
        }),
      ].join("\n") + "\n",
      "utf-8",
    );

    const createRes = await request.post("/api/projects", {
      data: { name: `triage-fix-now-e2e-${Date.now()}`, path: tmpDir },
    });
    expect(createRes.status()).toBeLessThan(300);
    const body = (await createRes.json()) as { data: { id: string } };
    projectId = body.data.id;
  });

  test.afterEach(async ({ request }) => {
    if (projectId) {
      try {
        await request.delete(`/api/projects/${projectId}`);
      } catch {
        // Best-effort cleanup; do not fail the test on teardown.
      }
    }
    if (tmpDir) {
      try {
        rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // Best-effort cleanup.
      }
    }
  });

  test("renders launchPayload, Fix-now copies cleaned text and shows confirmation", async ({
    page,
    context,
  }) => {
    // Clipboard permissions are required to read it back after the
    // button click. Grant for the served origin only.
    const baseUrl =
      process.env.BASE_URL || "http://localhost:5173";
    await context.grantPermissions(["clipboard-read", "clipboard-write"], {
      origin: new URL(baseUrl).origin,
    });

    // SPA-fallback gotcha (see CLAUDE.md learning) — production
    // `node dist/index.js` 404s on direct /triage. Land at "/" then
    // navigate in-app via the sidebar link.
    await page.goto("/");
    const sidebarTriage = page.getByRole("link", { name: /Triage/i }).first();
    await sidebarTriage.click();
    await expect(page).toHaveURL("/triage");

    // The new project's triage item should appear. Counts polling +
    // listItems polling can take up to 30 s in the worst case; bump
    // the wait window.
    const itemCard = page.getByTestId("triage-item-trg-e2efix01");
    await expect(itemCard).toBeVisible({ timeout: 35_000 });

    await itemCard.click();

    // Modal renders + launch-payload block surfaces the cleaned text.
    await expect(page.getByTestId("triage-detail-modal")).toBeVisible();
    const payloadPre = page.getByTestId("triage-launch-payload-content");
    await expect(payloadPre).toBeVisible();
    // The DOM should show the CLEANED text (control chars stripped) —
    // a broken renderer that emitted the raw payload would fail here.
    expect(await payloadPre.textContent()).toBe(CLEANED_LAUNCH_PAYLOAD);

    // Fix-now click → confirmation banner + clipboard write.
    await page.getByTestId("triage-fix-now").click();
    await expect(page.getByTestId("triage-fix-now-confirmation")).toBeVisible();

    // Clipboard MUST hold the cleaned string (not the raw bytes). The
    // operator-paste invariant: rendered text === copied text === no
    // control chars. External review iterate MED #11 + code-review LOW #6.
    //
    // Cross-OS line-ending note: Chromium on Windows normalises `\n`
    // produced by `navigator.clipboard.writeText` to `\r\n` on read.
    // Comparing both sides after the same normalisation is the correct
    // invariant — what matters for the operator paste is that the
    // logical text matches.
    const clipText = await page.evaluate(() => navigator.clipboard.readText());
    const normalize = (s: string): string => s.replace(/\r\n/g, "\n");
    const normalized = normalize(clipText);
    expect(normalized).toBe(CLEANED_LAUNCH_PAYLOAD);
    expect(normalized.includes("\x1b")).toBe(false);
    expect(normalized.includes("\x7f")).toBe(false);
  });
});
