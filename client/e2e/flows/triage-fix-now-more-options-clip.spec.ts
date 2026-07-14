/*
 * Spec — triage-fix-now: the "More options" panel must not be CLIPPED.
 *
 * iterate-2026-07-14-more-options-flex-clip.
 *
 * Bug: opening New Iterate from a triage item auto-expands "More options"
 * (the item carries suggestedPriority + suggestedDomain — see
 * useNewIssueFormState). The expanded panel was rendered CUT OFF at the
 * bottom: the Complexity-hint / Tags row was sliced in half and there was
 * no scrollbar to reach it.
 *
 * Root cause: MoreOptionsDisclosure carries `overflow-hidden`, which strips
 * its flex automatic minimum size, so ModalShell's bounded column-flex body
 * squeezed it below its content and clipped it — and, having absorbed the
 * negative free space, never became scrollable either. Fix: `[&>*]:shrink-0`
 * on the body. Canonical explanation: ModalShell.tsx.
 *
 * WHY THIS IS AN E2E AND NOT A UNIT TEST: jsdom has no layout engine — it
 * implements no flexbox and reports zero for every box metric — so this
 * class of bug is invisible to vitest by construction. ModalShell.test.tsx
 * pins the class as a CI fence (Playwright does not gate CI here); this
 * spec is the only thing that proves the actual rendered layout.
 */

import { test, expect } from "@playwright/test";
import { mkdirSync, rmSync, writeFileSync, mkdtempSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

test.describe("New Iterate from triage — More options is not clipped", () => {
  let tmpDir = "";
  let projectId = "";

  test.beforeEach(async ({ request }) => {
    tmpDir = mkdtempSync(path.join(tmpdir(), "more-options-clip-"));
    const triageDir = path.join(tmpDir, ".shipwright");
    mkdirSync(triageDir, { recursive: true });
    writeFileSync(
      path.join(triageDir, "triage.jsonl"),
      [
        JSON.stringify({
          v: 1,
          schema: "triage",
          created: "2026-07-14T08:00:00Z",
        }),
        // iterate-source item → Fix-now opens the new-iterate modal, and
        // suggestedPriority/suggestedDomain auto-expand More options.
        JSON.stringify({
          event: "append",
          id: "trg-clip0001",
          ts: "2026-07-14T08:01:00Z",
          originalTs: "2026-07-14T08:01:00Z",
          source: "iterate",
          severity: "medium",
          kind: "improvement",
          title:
            "Cross-repo contract: the WebUI renders grade's ReportModel with validation",
          detail:
            "The WebUI now renders grade's ReportModel + an honest 'report shape not recognised' state rather than a half-empty render.",
          evidencePath: null,
          runId: null,
          commit: null,
          dedupKey: "e2e:more-options-clip:iterate",
          status: "triage",
          suggestedPriority: "P2",
          suggestedDomain: "engineering",
        }),
      ].join("\n") + "\n",
      "utf-8",
    );

    const createRes = await request.post("/api/projects", {
      data: { name: `more-options-clip-e2e-${Date.now()}`, path: tmpDir },
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

  test("auto-expanded More options renders every field — panel is not squeezed, the modal body scrolls instead", async ({
    page,
  }) => {
    // Pin the viewport: the clip only manifests when the expanded content
    // exceeds the body's `max-h-[calc(100vh-280px)]`. At 720px tall that
    // budget is 440px and the expanded iterate form is far taller — so the
    // overflow this spec is about is guaranteed, not incidental.
    await page.setViewportSize({ width: 1280, height: 720 });

    await page.goto("/");
    await page.getByRole("link", { name: /Triage/i }).first().click();
    await expect(page).toHaveURL("/triage");

    const itemCard = page.getByTestId("triage-item-trg-clip0001");
    await expect(itemCard).toBeVisible({ timeout: 35_000 });
    await itemCard.click();

    await expect(page.getByTestId("triage-detail-modal")).toBeVisible();
    await page.getByTestId("triage-fix-now").click();

    await expect(page.getByTestId("new-issue-modal-new-iterate")).toBeVisible();

    // Precondition — the intended behavior we are NOT changing: coming from
    // triage, More options auto-expands so the carried-over priority/domain
    // are visible rather than silently hidden.
    const toggle = page.getByTestId("new-issue-more-options-toggle");
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    const content = page.getByTestId("new-issue-more-options-content");
    await expect(content).toBeVisible();

    const disclosure = page.getByTestId("new-issue-more-options");

    // --- THE REGRESSION ASSERTION ---------------------------------------
    // `overflow-hidden` makes clipped content invisible but still
    // MEASURABLE: a clipped box reports scrollHeight > clientHeight. On the
    // broken build the disclosure was squeezed to a fraction of its content
    // height, so this delta was in the hundreds of px.
    const clippedPx = await disclosure.evaluate(
      (el) => el.scrollHeight - el.clientHeight,
    );
    expect(
      clippedPx,
      "More options panel is clipped — flexbox shrank it below its content",
    ).toBeLessThanOrEqual(1);

    // The last field in the panel (Tags) must be fully inside the panel's
    // painted box — this is the row the user saw sliced in half.
    const tags = page.getByTestId("new-issue-tags-input");
    await expect(tags).toBeVisible();
    const tagsBox = await tags.boundingBox();
    const discBox = await disclosure.boundingBox();
    expect(tagsBox).not.toBeNull();
    expect(discBox).not.toBeNull();
    expect(
      tagsBox!.y + tagsBox!.height,
      "Tags field is cut off by the More options panel's bottom edge",
    ).toBeLessThanOrEqual(discBox!.y + discBox!.height + 1);

    // ...and the overflow must land where it belongs: the modal body is the
    // thing that scrolls. This is the half the original bug also broke —
    // the disclosure ate the overflow, so the body never became scrollable
    // and the clipped fields were unreachable by any scroll gesture.
    //
    // This assertion is also the ANTI-VACUITY guard: if a future layout
    // change made the expanded form fit inside the body, the clip assertions
    // above would pass trivially. Requiring a real overflow keeps them honest.
    const scrollable = await page
      .getByTestId("new-issue-modal-body")
      .evaluate((body) => ({
        scrollHeight: body.scrollHeight,
        clientHeight: body.clientHeight,
      }));
    expect(
      scrollable.scrollHeight,
      "modal body should overflow and scroll at this viewport",
    ).toBeGreaterThan(scrollable.clientHeight);

    // And the fields are actually reachable by scrolling.
    await tags.scrollIntoViewIfNeeded();
    await expect(tags).toBeInViewport();
  });
});
