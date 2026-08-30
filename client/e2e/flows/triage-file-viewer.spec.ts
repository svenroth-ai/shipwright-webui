import { test, expect } from "@playwright/test";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

/**
 * Triage compliance file viewer — F0.5 web-surface E2E
 * (iterate-2026-08-29-compliance-file-viewer).
 *
 * Compliance triage entries cite files inline (evidencePath, or a plain-text
 * mention like "architecture.md" inside `detail`) but the path was inert
 * text — there was no way to look at the file without leaving the browser.
 * This proves the real round trip: clicking a file reference in the Triage
 * detail popup opens a side panel that fetches and renders the REAL file
 * from the REAL seeded project directory through the existing path-guarded
 * file route — not a mock.
 */

const REAL_FILE_BODY = "# Architecture\n\nSome real file content for the viewer to render.\n";

// iterate-2026-08-30-triage-file-viewer-followups: a long-identifier .py file
// that overflows BOTH axes of the panel — long enough to require vertical
// scroll, and containing at least one line wide enough to require
// horizontal scroll (code is monospace, so a long single identifier alone
// reliably overflows a ~400px-wide panel).
const LONG_PY_BODY =
  Array.from(
    { length: 80 },
    (_, i) => `def some_function_number_${i}(argument_one, argument_two, argument_three):`,
  ).join("\n") +
  "\n    return argument_one_that_is_extremely_long_and_will_not_wrap_in_a_monospace_pre_block + argument_two\n";

function appendLine(id: string, title: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    event: "append",
    id,
    ts: "2026-08-29T08:00:00Z",
    originalTs: "2026-08-29T08:00:00Z",
    source: "compliance",
    severity: "medium",
    kind: "compliance",
    title,
    detail: "Original detail",
    evidencePath: null,
    runId: null,
    commit: null,
    dedupKey: `compliance:${id}`,
    status: "triage",
    suggestedPriority: "P2",
    suggestedDomain: "compliance",
    ...extra,
  });
}

async function seedProject(
  request: import("@playwright/test").APIRequestContext,
  slug: string,
  lines: string[],
  extraFiles: Record<string, string> = {},
): Promise<{ projectDir: string; projectId: string }> {
  const projectDir = path.join(tmpdir(), `${slug}-${Date.now()}`);
  mkdirSync(path.join(projectDir, ".shipwright"), { recursive: true });
  writeFileSync(
    path.join(projectDir, ".shipwright", "triage.jsonl"),
    [`{"v":1,"schema":"triage","created":"2026-08-29T00:00:00Z"}`, ...lines].join("\n") + "\n",
    "utf-8",
  );
  writeFileSync(path.join(projectDir, "architecture.md"), REAL_FILE_BODY, "utf-8");
  for (const [rel, body] of Object.entries(extraFiles)) {
    writeFileSync(path.join(projectDir, rel), body, "utf-8");
  }
  const created = await request.post("/api/projects", {
    data: { name: slug, path: projectDir.split(path.sep).join("/") },
  });
  expect(created.ok()).toBeTruthy();
  const projectId = ((await created.json()) as { data: { id: string } }).data.id;
  return { projectDir, projectId };
}

test.describe("Triage compliance file viewer", () => {
  let projectDir = "";
  let projectId = "";

  test.afterEach(async ({ request }) => {
    if (projectId) {
      await request.delete(`/api/projects/${projectId}`).catch(() => {});
    }
    if (projectDir) rmSync(projectDir, { recursive: true, force: true });
    projectDir = "";
    projectId = "";
  });

  test("a file mention in a compliance finding's detail opens the real file beside the triage panel", async ({
    page,
    request,
  }) => {
    ({ projectDir, projectId } = await seedProject(request, "triage-file-viewer", [
      appendLine("trg-fv0001", "F/F5: Architecture marker vs arch-impact drops", {
        detail: "architecture.md has no shipwright:architecture marker, but 1 arch-impact drop(s) exist",
      }),
    ]));

    await page.goto("/triage");
    await expect(page.getByTestId("triage-item-trg-fv0001")).toBeVisible({ timeout: 15000 });
    await page.getByTestId("triage-item-trg-fv0001").click();

    const modal = page.getByTestId("triage-detail-modal");
    await expect(modal).toBeVisible();
    await expect(page.getByTestId("triage-file-panel")).toHaveCount(0);

    const link = modal.locator('[data-file-path="architecture.md"]');
    await expect(link).toContainText("architecture.md");
    await link.click();

    const panel = page.getByTestId("triage-file-panel");
    await expect(panel).toBeVisible();
    await expect(page.getByTestId("triage-file-panel-path")).toContainText("architecture.md");
    // Real content from the real seeded file, fetched through the existing
    // path-guarded file route — not a mocked response.
    await expect(panel).toContainText("Some real file content for the viewer to render.");

    // Panel sits BESIDE the triage details, not on top of them — both
    // visible at once, panel to the right.
    const modalBox = await modal.boundingBox();
    const panelBox = await panel.boundingBox();
    expect(modalBox).not.toBeNull();
    expect(panelBox).not.toBeNull();
    if (modalBox && panelBox) {
      expect(panelBox.x).toBeGreaterThan(modalBox.x + modalBox.width / 2);
      // Regression guard (iterate-2026-08-30-triage-panel-width): the panel
      // was widened because most linked files needed excessive vertical
      // scrolling at the old width. At this suite's default 1280px viewport,
      // max-w-[95vw] clamps the modal to 1216px, so the panel goes from
      // ~460px (old 1100px modal) to ~576px (new 1440px modal) — assert
      // comfortably above the old width without pinning the exact number.
      expect(panelBox.width).toBeGreaterThan(520);
    }

    await page.getByTestId("triage-file-panel-close").click();
    await expect(page.getByTestId("triage-file-panel")).toHaveCount(0);
    // Closing the panel doesn't close the triage modal itself.
    await expect(modal).toBeVisible();
  });

  test("evidencePath renders as a clickable link for a structured-source finding", async ({
    page,
    request,
  }) => {
    ({ projectDir, projectId } = await seedProject(request, "triage-file-viewer-evidence", [
      appendLine("trg-fv0002", "F0.5 surface verification gap", {
        source: "f0.5",
        detail: "surface_verification block missing",
        evidencePath: "architecture.md",
      }),
    ]));

    await page.goto("/triage");
    await expect(page.getByTestId("triage-item-trg-fv0002")).toBeVisible({ timeout: 15000 });
    await page.getByTestId("triage-item-trg-fv0002").click();

    const modal = page.getByTestId("triage-detail-modal");
    await expect(modal).toBeVisible();
    await modal.locator('[data-file-path="architecture.md"]').click();

    await expect(page.getByTestId("triage-file-panel")).toBeVisible();
    await expect(page.getByTestId("triage-file-panel-path")).toContainText("architecture.md");
  });

  test("on a narrow (phone-width) viewport, opening the file panel does not clip either surface", async ({
    page,
    request,
  }) => {
    // Code-review regression guard (iterate-2026-08-29-compliance-file-viewer):
    // a fixed-width left column once clipped content below md, and even after
    // that was fixed, an open panel below md briefly resolved to 0px wide.
    await page.setViewportSize({ width: 375, height: 812 });
    ({ projectDir, projectId } = await seedProject(request, "triage-file-viewer-narrow", [
      appendLine("trg-fv0003", "F/F5: narrow viewport check", {
        detail: "architecture.md has no shipwright:architecture marker",
      }),
    ]));

    await page.goto("/triage");
    await expect(page.getByTestId("triage-item-trg-fv0003")).toBeVisible({ timeout: 15000 });
    await page.getByTestId("triage-item-trg-fv0003").click();

    const modal = page.getByTestId("triage-detail-modal");
    await expect(modal).toBeVisible();
    // Closed-panel state: the action row (Fix now) must be reachable, not
    // clipped off-screen by a fixed-width column wider than the viewport.
    await expect(modal.getByTestId("triage-fix-now")).toBeInViewport();

    await modal.locator('[data-file-path="architecture.md"]').click();
    const panel = page.getByTestId("triage-file-panel");
    await expect(panel).toBeVisible();
    const panelBox = await panel.boundingBox();
    expect(panelBox).not.toBeNull();
    if (panelBox) {
      // Not 0-width: the left column is hidden below md while a file is
      // open, so the panel gets the full row instead of a 0px flex share.
      expect(panelBox.width).toBeGreaterThan(200);
    }
    await expect(page.getByTestId("triage-file-panel-close")).toBeInViewport();
  });

  test("a long, wide .py file scrolls both vertically and horizontally instead of being clipped (iterate-2026-08-30-triage-file-viewer-followups)", async ({
    page,
    request,
  }) => {
    ({ projectDir, projectId } = await seedProject(
      request,
      "triage-file-viewer-scroll",
      [
        appendLine("trg-fv0004", "Long code file scroll check", {
          evidencePath: "long_module.py",
        }),
      ],
      { "long_module.py": LONG_PY_BODY },
    ));

    await page.goto("/triage");
    await expect(page.getByTestId("triage-item-trg-fv0004")).toBeVisible({ timeout: 15000 });
    await page.getByTestId("triage-item-trg-fv0004").click();

    const modal = page.getByTestId("triage-detail-modal");
    await expect(modal).toBeVisible();
    await modal.locator('[data-file-path="long_module.py"]').click();

    const code = page.getByTestId("smart-viewer-code");
    await expect(code).toBeVisible();
    await expect(code).toContainText("some_function_number_0");

    const metrics = await code.evaluate((el) => ({
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
    }));
    expect(metrics.scrollHeight).toBeGreaterThan(metrics.clientHeight);
    expect(metrics.scrollWidth).toBeGreaterThan(metrics.clientWidth);

    // The panel itself must never grow past the Dialog's own bound — this is
    // the regression this test exists to catch (it grew past the Dialog's
    // clipped box with no internal scrollbar before the fix).
    const panel = page.getByTestId("triage-file-panel");
    const modalBox = await modal.boundingBox();
    const panelBox = await panel.boundingBox();
    expect(modalBox).not.toBeNull();
    expect(panelBox).not.toBeNull();
    if (modalBox && panelBox) {
      expect(panelBox.height).toBeLessThanOrEqual(modalBox.height + 1);
    }

    await page.screenshot({ path: "test-results/triage-file-viewer-scroll.png" });
  });

  test("a mention of a file that does not exist under the project renders as plain text, never a clickable link (iterate-2026-08-30-triage-file-viewer-followups)", async ({
    page,
    request,
  }) => {
    ({ projectDir, projectId } = await seedProject(request, "triage-file-viewer-broken-link", [
      appendLine("trg-fv0005", "REQ3.04c broken-link check", {
        detail:
          "shipwright_ac_coverage_baseline.json is stale; see shared/scripts/lib/anti_ratchet.py for the resolver",
        evidencePath: "shipwright_ac_coverage_baseline.json",
      }),
    ]));

    await page.goto("/triage");
    await expect(page.getByTestId("triage-item-trg-fv0005")).toBeVisible({ timeout: 15000 });
    await page.getByTestId("triage-item-trg-fv0005").click();

    const modal = page.getByTestId("triage-detail-modal");
    await expect(modal).toBeVisible();

    // The nonexistent path never becomes a link — plain text only, both as
    // the evidence line and inline in the detail body (two separate mentions
    // of the same broken filename: the structured evidencePath, and the
    // inline mention inside `detail`).
    await expect(modal.getByText("shipwright_ac_coverage_baseline.json")).toHaveCount(2);
    await expect(modal.locator('[data-file-path="shipwright_ac_coverage_baseline.json"]')).toHaveCount(0);
    // Give the async existence check a moment to settle either way, then
    // re-assert no link ever appeared for the broken path.
    await page.waitForTimeout(500);
    await expect(modal.locator('[data-file-path="shipwright_ac_coverage_baseline.json"]')).toHaveCount(0);
  });
});
