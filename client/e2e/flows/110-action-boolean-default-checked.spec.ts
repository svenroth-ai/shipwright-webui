/*
 * iterate-2026-11-10-screenshots-with-description — FR-01.37.
 * A custom action's boolean parameter declared with `default: true` opens
 * PRE-CHECKED in the start dialog (the user can still untick it), and the
 * upload validator now accepts both that and fixed flags in `slash_command`.
 */
import {
  cleanupProject,
  seedProject,
  setActiveProject,
  type SeededProject,
} from "../helpers/fixtures";
import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

const actionsJson = (slash: string) => ({
  phases: [{ id: "build", label: "Build" }],
  actions: [
    {
      id: "run-orchestrator",
      label: "Orchestrator",
      kind: "external_launch",
      command_template:
        "claude --session-id {task.uuid} {plugin.dirs} {task.initial_prompt}",
      slash_command: slash,
      modal_fields: ["title", "description"],
      parameters: [
        {
          name: "noreview",
          label: "Skip review",
          type: "boolean",
          cli_flag: "--noreview",
          default: true,
        },
        { name: "fast", label: "Fast mode", type: "boolean", cli_flag: "--fast" },
      ],
    },
  ],
  defaults: { autonomy: "guided" },
  preview: { enabled: false, command: null, port: null, ready_path: null, ready_timeout_seconds: null },
  diagnostics: [],
});

test.describe("Action boolean default:true + slash_command flags (FR-01.37)", () => {
  let project: SeededProject;

  test.beforeEach(async ({ page, request }) => {
    project = await seedProject(request, { name: "110-bool-default", adopted: true });
    await setActiveProject(page, project.projectId);
  });
  test.afterEach(async ({ request }) => {
    await cleanupProject(request, project);
  });

  async function openDialog(page: Page, request: APIRequestContext) {
    const upload = await request.post(`/api/projects/${project.projectId}/actions-upload`, {
      data: actionsJson("/content-orchestrator --depth=3"),
    });
    expect(upload.ok(), await upload.text()).toBeTruthy();

    await page.goto("/");
    await page.getByTestId("create-menu-caret").click();
    await page.getByTestId("create-menu-item-run-orchestrator").click();
    await page.getByTestId("new-issue-more-options-toggle").click();
    await page.getByTestId("new-issue-advanced-toggle").click();
    await page.getByPlaceholder(/Fix login redirect bug/).fill("e2e default");
    return {
      preChecked: page.getByTestId("paramfield-noreview").locator("input[type=checkbox]"),
      plain: page.getByTestId("paramfield-fast").locator("input[type=checkbox]"),
    };
  }

  const saveAndCapture = async (page: Page) => {
    // Parameters travel with the LAUNCH request (Save-to-Backlog sends none).
    const sent = page.waitForRequest(
      (r) => r.method() === "POST" && r.url().endsWith("/launch"),
    );
    await page.getByTestId("new-issue-launch-btn").click();
    return (await sent).postData() ?? "";
  };

  // @covers FR-01.37
  test("upload accepts default:true + flagged slash_command; dialog opens ticked and sends the flag", async ({
    page,
    request,
  }) => {
    const { preChecked, plain } = await openDialog(page, request);
    await expect(preChecked).toBeChecked();
    await expect(plain).not.toBeChecked();
    const body = await saveAndCapture(page);
    expect(body).toContain('"noreview":true');
    expect(body).not.toContain('"fast"');
  });

  // @covers FR-01.37
  test("the user can untick the pre-checked box and the flag is then not sent", async ({
    page,
    request,
  }) => {
    const { preChecked } = await openDialog(page, request);
    await preChecked.uncheck();
    await expect(preChecked).not.toBeChecked();
    const body = await saveAndCapture(page);
    expect(body).not.toContain('"noreview":true');
  });

  // @covers FR-01.37
  test("a slash_command with shell metacharacters is still rejected", async ({ request }) => {
    const upload = await request.post(`/api/projects/${project.projectId}/actions-upload`, {
      data: actionsJson("/content-orchestrator --x; rm -rf /"),
    });
    expect(upload.status()).toBe(400);
  });
});
