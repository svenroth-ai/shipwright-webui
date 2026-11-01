/*
 * campaign mission-desktop-style-v2, V9 - mobile polish + accessibility, REAL browser on a touch phone
 * (Pixel 5: isMobile + hasTouch, so `pointer: coarse` and `max-width: 767px` really resolve true).
 *  - Chat: tables scroll in their own frame (the page never scrolls sideways); every tap target in the
 *    Mission body is >= 44px; the keyboard focus ring is 3px.
 *  - Agents: full-screen sheet; list (56px rows) -> tap -> detail with a 44px Back -> list.
 *  - Files & Terminal: one 44px tab bar; the row "..." opens a bottom sheet.
 *  - A11y: the running dot is still under prefers-reduced-motion and pulses otherwise.
 * Read-only: no composer, no chat-* surface.
 *
 * @covers FR-01.66
 */
import { test, expect, devices, type Page } from "@playwright/test";
import { cleanupProject, cleanupTask, seedProject, seedTask, setActiveProject, type SeededProject } from "../helpers/fixtures";
import { writeFiles } from "../helpers/temp-dir";
import { seedClaudeJsonlEvents } from "../helpers/claude-jsonl";

test.use({ ...devices["Pixel 5"] });

const RUN_ID = "iterate-2026-11-01-v9-mobile-e2e";
const SPEC_DOC = "# V9 mobile fixture\n\nTouches FR-01.66 only.\n\n## Affected Boundaries\n\nReads the session JSONL.\n";
const WIDE_TABLE = [
  "Here is the summary:",
  "",
  "| Part | PR | What changed in this part of the campaign, in a deliberately long sentence | Owner |",
  "|---|---|---|---|",
  "| M1 | #545 | Error cards removed, subrunner check marks made row-sized so they are easy to hit | runner-one |",
  "| M2 | #546 | Server endpoint session-info with a very long description that must not widen the page | runner-two |",
].join("\n");

const sub = (o: Record<string, unknown>) => ({
  agentType: "sub-iterate-runner", description: "x", toolUseId: null, spawnDepth: 1, parentAgentId: null, model: null,
  prompt: "Do the thing", answer: "Done.", startedAt: null, endedAt: null, durationMs: 4000, state: "finished",
  status: "completed", tokens: null, toolUses: null, ...o,
});
const SUBAGENTS = [
  sub({ agentId: "run1", state: "running", status: null, description: "Running reviewer" }),
  sub({ agentId: "ok1", description: "Finished builder", answer: "All merged." }),
];

/** Visible interactive elements under `scope` whose box is shorter than `min`px (inline prose links exempt). */
async function smallTargets(page: Page, scope: string, min = 44): Promise<string[]> {
  return page.evaluate(
    ({ scope, min }) => {
      const out: string[] = [];
      for (const root of document.querySelectorAll(scope)) {
        for (const el of root.querySelectorAll<HTMLElement>("button, a[href], [role=tab], [role=radio], [role=menuitem], summary")) {
          const r = el.getBoundingClientRect();
          const cs = getComputedStyle(el);
          if (r.width === 0 || r.height === 0 || cs.visibility === "hidden" || cs.display === "none") continue;
          if (el.tagName === "A" && el.closest("p, li, td, th, .markdown-body, .mc-handback-body")) continue;
          if (r.height < min - 0.5) out.push(`${el.tagName.toLowerCase()}.${el.className.toString().split(" ")[0]} "${(el.textContent ?? "").trim().slice(0, 24)}" ${Math.round(r.height)}px`);
        }
      }
      return out;
    },
    { scope, min },
  );
}

test.describe("V9 - mobile + accessibility (phone)", () => {
  test.describe.configure({ timeout: 150_000 });
  let project: SeededProject;
  let taskId = "";
  let projectSeeded = false;

  test.beforeEach(async ({ page, request }) => {
    taskId = "";
    projectSeeded = false;
    project = await seedProject(request, {
      name: "V9MobileE2E",
      adopted: true,
      files: { "README.md": "# V9\n\n" + "a very long line without any break ".repeat(12) + "\n", "src/a.ts": "export const a = 1;\n" },
    });
    projectSeeded = true;
    await setActiveProject(page, project.projectId);
    await page.route("**/api/external/tasks/*/session-info", (route) =>
      route.fulfill({
        json: {
          status: "ok",
          info: { sessionUuid: "u", context: {}, compaction: { count: 0, last: null }, outputs: [], remoteControl: { active: false, onceEnabled: false, pid: null }, subagents: SUBAGENTS, scan: {} },
        },
      }),
    );
  });
  test.afterEach(async ({ request }) => {
    if (taskId) await cleanupTask(request, taskId);
    if (projectSeeded) await cleanupProject(request, project);
  });

  async function seedMission(request: Parameters<typeof seedTask>[0]) {
    const task = await seedTask(request, { title: "V9 mobile", projectId: project.projectId });
    taskId = task.taskId;
    await writeFiles(project.path, {
      [`.shipwright/iterate_active/${task.sessionUuid}.json`]: JSON.stringify({ run_id: RUN_ID, slug: "v9-mobile-e2e", branch: "iterate/v9-mobile-e2e", main_root: project.path, session_id: task.sessionUuid, created_at: "2026-11-01T09:00:00Z" }),
      [`.shipwright/planning/iterate/${RUN_ID}/mini-plan.md`]: SPEC_DOC,
    });
    seedClaudeJsonlEvents({
      sessionUuid: task.sessionUuid,
      cwd: task.cwd,
      events: [
        { type: "user", message: { role: "user", content: [{ type: "text", text: "Summarise the campaign." }] } },
        { type: "assistant", timestamp: "2026-11-01T10:00:00.000Z", message: { role: "assistant", content: [{ type: "text", text: WIDE_TABLE }] } },
      ],
    });
    return task;
  }

  // @covers FR-01.66
  test("chat: the table scrolls in its own frame, the page never scrolls sideways, targets are 44px, focus ring is 3px", async ({ page, request }) => {
    await seedMission(request);
    await page.goto(`/tasks/${taskId}`, { waitUntil: "domcontentloaded", timeout: 20_000 });
    await page.getByTestId("mission-tab-mission").click();
    await page.getByTestId("mission-compact-tab-activity").click();
    const feed = page.getByTestId("mission-activity-feed");
    await expect(feed).toBeVisible({ timeout: 15_000 });
    await expect(feed.locator("textarea, input")).toHaveCount(0);
    await expect(page.locator("[data-testid^='chat-']")).toHaveCount(0);

    const wrap = feed.locator(".mc-table-wrap").first();
    await expect(wrap).toBeVisible();
    const m = await wrap.evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth, ox: getComputedStyle(el).overflowX }));
    expect(m.ox).toBe("auto");
    expect(m.sw).toBeGreaterThan(m.cw); // the table is wider than its frame ...
    const doc = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
    expect(doc.sw).toBeLessThanOrEqual(doc.iw); // ... and the page itself does not scroll sideways

    // Run result card actions: full width, 44px (only when the fixture produced a result card).
    const resultBtn = feed.getByTestId("run-result-row").first().getByRole("button");
    if (await resultBtn.count()) {
      const row = await feed.getByTestId("run-result-row").first().boundingBox();
      const b = await resultBtn.first().boundingBox();
      expect(b!.height).toBeGreaterThanOrEqual(44);
      expect(b!.width).toBeGreaterThan(row!.width * 0.8);
    }

    expect(await smallTargets(page, "[data-testid=mission-compact-tabs], [data-testid=mission-body] .mc-op")).toEqual([]);

    // 3px teal focus ring on a keyboard-focused control.
    const chip = page.getByTestId("agents-bar-button");
    await expect(chip).toBeVisible();
    await page.keyboard.press("Tab");
    await chip.focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    await expect(chip).toBeFocused();
    expect(await chip.evaluate((el) => getComputedStyle(el).boxShadow)).toMatch(/0px 0px 0px 3px/);
  });

  // @covers FR-01.66
  test("agents: full-screen sheet, 56px rows, list -> detail -> Back; running dot still under reduced motion", async ({ page, request }) => {
    await seedMission(request);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(`/tasks/${taskId}`, { waitUntil: "domcontentloaded", timeout: 20_000 });
    await page.getByTestId("mission-tab-mission").click();
    await page.getByTestId("mission-compact-tab-activity").click();
    await page.getByTestId("agents-bar-button").click();
    const win = page.getByTestId("agents-window");
    await expect(win).toBeVisible();
    const vp = page.viewportSize()!;
    const box = await win.boundingBox();
    expect(Math.round(box!.width)).toBe(vp.width);
    expect(Math.round(box!.height)).toBe(vp.height);
    await expect(page.getByTestId("agents-list")).toBeVisible();
    await expect(page.getByTestId("agent-detail")).toBeHidden();
    for (const id of ["run1", "ok1"]) expect((await page.getByTestId(`agent-row-${id}`).boundingBox())!.height).toBeGreaterThanOrEqual(56);
    await expect(page.getByTestId("agents-back")).toBeHidden();
    expect(await page.getByTestId("agent-row-run1").locator(".ag-dot").evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
    await expect(page.getByTestId("agent-row-ok1").locator(".ag-pill")).toHaveText("completed");
    await expect(page.getByTestId("agent-row-run1").locator(".ag-pill")).toHaveText("running");
    await page.getByTestId("agent-row-ok1").click();
    await expect(page.getByTestId("agent-detail")).toBeVisible();
    await expect(page.getByTestId("agents-list")).toBeHidden();
    const back = page.getByTestId("agents-back");
    expect((await back.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect(await smallTargets(page, "[data-testid=agents-window]")).toEqual([]);
    await expect(back).toBeFocused(); // keyboard users follow the drill-down
    await back.click();
    await expect(page.getByTestId("agent-row-ok1")).toBeFocused(); // ... and Back returns to the row they came from
    await expect(page.getByTestId("agents-list")).toBeVisible();
    await expect(page.getByTestId("agent-detail")).toBeHidden();
    await page.emulateMedia({ reducedMotion: "no-preference" });
    expect(await page.getByTestId("agent-row-run1").locator(".ag-dot").evaluate((el) => getComputedStyle(el).animationName)).not.toBe("none");
  });

  // @covers FR-01.66
  test("files & terminal: 44px tab bar and rows, the row actions open a bottom sheet", async ({ page, request }) => {
    const task = await seedTask(request, { title: "V9 files", projectId: project.projectId });
    taskId = task.taskId;
    await page.goto(`/tasks/${taskId}`);
    const bar = page.getByTestId("pane-tab-bar");
    await expect(bar).toBeVisible({ timeout: 35_000 });
    await expect(bar.getByRole("tablist")).toBeVisible();
    expect(await smallTargets(page, "[data-testid=pane-tab-bar]")).toEqual([]);
    await page.getByTestId("pane-tab-left").click();
    const row = page.getByTestId("folder-tree-row-README.md");
    await expect(row).toBeVisible();
    expect((await row.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await page.getByTestId("folder-tree-more-README.md").tap();
    const sheet = page.getByTestId("folder-tree-sheet");
    await expect(sheet).toBeVisible();
    const sb = await sheet.boundingBox();
    const vp = page.viewportSize()!;
    expect(sb!.y + sb!.height).toBeGreaterThan(vp.height - 4); // docked to the bottom edge
    expect(Math.round(sb!.width)).toBe(vp.width);
    for (const item of await sheet.locator(".ft-sheet-item").all()) expect((await item.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  });
});
