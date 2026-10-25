/**
 * @covers FR-01.75
 * Custom stack profiles — real browser, real resolver CLI.
 *
 * Needs (set by whoever runs the suite; the spec skips with a reason without them):
 *   SHIPWRIGHT_RESOLVE_PROFILE_SCRIPT  absolute path to resolve_profile.py
 *   SHIPWRIGHT_USER_PROFILES_DIR       an empty temp dir used as ~/.shipwright/profiles
 * The isolated stack runs with an ephemeral HOME that has no plugin cache, so
 * both are passed explicitly instead of guessed.
 */
import { test, expect } from "@playwright/test";
import { mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";

const script = process.env.SHIPWRIGHT_RESOLVE_PROFILE_SCRIPT;
const userDir = process.env.SHIPWRIGHT_USER_PROFILES_DIR;

// @covers FR-01.75
test.describe("Custom stack profiles", () => {
  // @covers FR-01.75
  test.skip(!script || !userDir, "SHIPWRIGHT_RESOLVE_PROFILE_SCRIPT / SHIPWRIGHT_USER_PROFILES_DIR not set");

  // @covers FR-01.75
  test.beforeEach(() => {
    mkdirSync(userDir as string, { recursive: true });
    writeFileSync(
      path.join(userDir as string, "e2e-mine.json"),
      JSON.stringify({ name: "e2e-mine", schema_version: 1, description: "E2E personal stack" }),
    );
    writeFileSync(path.join(userDir as string, "e2e-broken.json"), '{"name":"e2e-broken",');
  });
  // @covers FR-01.75
  test.afterEach(() => {
    for (const f of ["e2e-mine", "e2e-broken", "e2e-created"]) {
      rmSync(path.join(userDir as string, `${f}.json`), { force: true });
    }
  });

  // @covers FR-01.75
  test("Settings lists own profiles by source, flags the broken one, and creates a copy", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.getByTestId("stack-profiles-group-user")).toBeVisible();
    await expect(page.getByTestId("stack-profile-e2e-mine")).toBeVisible();
    await expect(page.getByTestId("stack-profile-invalid-e2e-broken")).toContainText("Not usable");
    await expect(page.getByTestId("stack-profiles-group-bundled")).toBeVisible();

    await page.getByTestId("stack-profile-check-e2e-mine").click();
    await expect(page.getByTestId("stack-profile-e2e-mine")).toContainText("Valid");

    await page.getByTestId("stack-profiles-name").fill("e2e-created");
    await page.getByTestId("stack-profiles-create-btn").click();
    await expect(page.getByTestId("stack-profiles-message")).toContainText("Created “e2e-created”");
    await expect(page.getByTestId("stack-profile-e2e-created")).toBeVisible();
    expect(existsSync(path.join(userDir as string, "e2e-created.json"))).toBe(true);

    // creating the same name again is refused, nothing overwritten
    await page.getByTestId("stack-profiles-name").fill("e2e-created");
    await page.getByTestId("stack-profiles-create-btn").click();
    await expect(page.getByTestId("stack-profiles-message")).toContainText("already exists");
  });

  // @covers FR-01.75
  test("Wizard: an own profile skips the stack questions; 'I'm new' keeps them", async ({ page }) => {
    const listed = page.waitForResponse((r) => r.url().includes("/api/stack-profiles") && r.ok());
    await page.goto("/wizard");
    await listed; // the list is fetched when the wizard opens
    await page.getByTestId("wizard-door-new").click();
    await page.getByTestId("wizard-brief-input").fill("A yoga booking tool");
    await page.getByTestId("wizard-next").click();

    // the explained stack question, own profile selectable, broken one not
    await expect(page.getByTestId("wizard-question-profile")).toContainText("tech stack");
    await expect(page.getByTestId("wizard-stack-e2e-mine")).toBeEnabled();
    await expect(page.getByTestId("wizard-stack-e2e-broken")).toBeDisabled();
    await expect(page.getByTestId("wizard-stack-invalid-e2e-broken")).toContainText("Can’t be used yet");

    await page.getByTestId("wizard-stack-e2e-mine").click();
    await page.getByTestId("wizard-next").click();
    await expect(page.getByTestId("wizard-question-who")).toBeVisible();
    await page.getByTestId("wizard-opt-who").first().click();
    await page.getByTestId("wizard-next").click();
    // straight to the plan: remember / where were never asked
    await expect(page.getByTestId("wizard-plan-card")).toContainText("e2e-mine");
    await expect(page.getByTestId("wizard-question-remember")).toHaveCount(0);

    // back to the stack question and choose "I'm new" → the classic questions return
    await page.getByTestId("wizard-back").click();
    await page.getByTestId("wizard-back").click();
    await page.getByTestId("wizard-stack-derive").click();
    await page.getByTestId("wizard-next").click();
    await page.getByTestId("wizard-opt-who").first().click();
    await page.getByTestId("wizard-next").click();
    await expect(page.getByTestId("wizard-question-remember")).toBeVisible();
  });
});
