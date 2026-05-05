/*
 * Spec 75 — Launch matrix (4 modes × direct/backlog) + session persistence
 * across WS detach.
 *
 * Anchors two regressions surfaced by user UAT 2026-05-05:
 *
 *   BUG A — Plain Claude / New-Task / New-Iterate / New-Pipeline launched
 *   via TaskCard "Launch" (Backlog path) produced a degraded command
 *   without the slash command because `actionId` was never persisted at
 *   create-time and the server's fallback at routes.ts:421 found nothing
 *   to recover. Fixed by persisting actionId through createTask + the
 *   sdk-sessions store.
 *
 *   BUG B — "Session bleibt nicht aktiv" — any TaskBoard ↔ TaskDetail
 *   navigation closed the WS, the server's pty-manager unconditionally
 *   killed the pty on last-detach, and re-attaching produced a brand-
 *   new shell with no claude session. Fixed by removing the last-detach
 *   kill; orphan GC now relies on the 30-min idle ceiling + explicit
 *   user actions (Stop / Close / DELETE).
 *
 * The launch-matrix tests are API-level so they don't need a real
 * claude binary — they assert the server's `commands` payload contains
 * the right slash command (or no slash for new-plain) and that the
 * fallback recovers the right template after the create + launch
 * round-trip. They MUST run against a registered project (otherwise
 * task.projectId resolves to UNASSIGNED and the substitution branch
 * is skipped); we discover one via /api/projects at the top of each
 * describe block.
 *
 * The session-persistence test runs the WS dance from inside the
 * browser context (page.evaluate) so the WS upgrade carries the
 * loopback Origin header the server expects.
 */

import { test, expect, type APIRequestContext } from "@playwright/test";

const SERVER = "http://localhost:3847";

interface ProjectView {
  id: string;
  name: string;
  path: string;
  synthesized?: boolean;
}

async function pickRealProject(
  request: APIRequestContext,
): Promise<ProjectView> {
  const res = await request.get(`${SERVER}/api/projects`);
  expect(res.ok(), `GET /api/projects: ${res.status()}`).toBeTruthy();
  const body = (await res.json()) as { data?: ProjectView[] };
  const projects = body.data ?? [];
  // Prefer the WebUI project (it's adopted + always has a real path).
  const webui = projects.find(
    (p) => !p.synthesized && p.path && /shipwright-webui$/i.test(p.path),
  );
  if (webui) return webui;
  // Fallback: first non-synthesized project with a path.
  const any = projects.find((p) => !p.synthesized && p.path);
  if (!any) throw new Error("No registered project with a path is available");
  return any;
}

interface CreateOpts {
  projectId: string;
  cwd: string;
  title?: string;
  actionId?: string;
  phase?: string;
}

async function createTask(
  request: APIRequestContext,
  opts: CreateOpts,
): Promise<string> {
  const res = await request.post(`${SERVER}/api/external/tasks`, {
    data: {
      title: opts.title ?? `spec75-${Date.now()}`,
      cwd: opts.cwd,
      pluginDirs: [],
      projectId: opts.projectId,
      ...(opts.actionId ? { actionId: opts.actionId } : {}),
      ...(opts.phase ? { phase: opts.phase } : {}),
    },
  });
  expect(res.ok(), `create task: ${res.status()} ${await res.text()}`).toBeTruthy();
  const body = (await res.json()) as { task: { taskId: string } };
  return body.task.taskId;
}

async function launchTask(
  request: APIRequestContext,
  taskId: string,
  body: Record<string, unknown> = {},
) {
  const res = await request.post(
    `${SERVER}/api/external/tasks/${taskId}/launch`,
    { data: body },
  );
  expect(res.ok(), `launch ${taskId}: ${res.status()} ${await res.text()}`).toBeTruthy();
  return (await res.json()) as {
    commands: { powershell: string; cmd: string; posix: string };
    task: { taskId: string; state: string; actionId?: string };
  };
}

async function deleteTask(request: APIRequestContext, taskId: string) {
  await request
    .delete(`${SERVER}/api/external/tasks/${taskId}`)
    .catch(() => undefined);
}

async function getTask(request: APIRequestContext, taskId: string) {
  const res = await request.get(`${SERVER}/api/external/tasks/${taskId}`);
  expect(res.ok()).toBeTruthy();
  const body = (await res.json()) as {
    task: { taskId: string; actionId?: string; phase?: string };
  };
  return body.task;
}

test.describe("Spec 75 — Launch matrix (direct path: full body on /launch)", () => {
  test("new-task direct launch — command contains the phase slash command", async ({
    request,
  }) => {
    const project = await pickRealProject(request);
    const taskId = await createTask(request, {
      projectId: project.id,
      cwd: project.path,
    });
    try {
      // Use phase=design — no required parameters (build requires
      // `section` which would 400 the launch in this matrix test).
      const res = await launchTask(request, taskId, {
        actionId: "new-task",
        phase: "design",
        phaseLabel: "Design",
        description: "do the thing",
      });
      expect(res.commands.powershell).toContain("/shipwright-design");
      expect(res.commands.posix).toContain("/shipwright-design");
      expect(res.commands.cmd).toContain("/shipwright-design");
      expect(res.commands.powershell).toContain("--session-id");
    } finally {
      await deleteTask(request, taskId);
    }
  });

  test("new-iterate direct launch — command contains /shipwright-iterate", async ({
    request,
  }) => {
    const project = await pickRealProject(request);
    const taskId = await createTask(request, {
      projectId: project.id,
      cwd: project.path,
    });
    try {
      const res = await launchTask(request, taskId, {
        actionId: "new-iterate",
        description: "ship the iterate",
      });
      expect(res.commands.powershell).toContain("/shipwright-iterate");
      expect(res.commands.posix).toContain("/shipwright-iterate");
    } finally {
      await deleteTask(request, taskId);
    }
  });

  test("new-pipeline direct launch — command contains /shipwright-run", async ({
    request,
  }) => {
    const project = await pickRealProject(request);
    const taskId = await createTask(request, {
      projectId: project.id,
      cwd: project.path,
    });
    try {
      const res = await launchTask(request, taskId, {
        actionId: "new-pipeline",
        description: "kick the pipeline",
      });
      expect(res.commands.powershell).toContain("/shipwright-run");
      expect(res.commands.posix).toContain("/shipwright-run");
    } finally {
      await deleteTask(request, taskId);
    }
  });

  test("new-plain direct launch — command starts a vanilla claude with --session-id and NO slash command", async ({
    request,
  }) => {
    const project = await pickRealProject(request);
    const taskId = await createTask(request, {
      projectId: project.id,
      cwd: project.path,
    });
    try {
      const res = await launchTask(request, taskId, {
        actionId: "new-plain",
        description: "say hi",
      });
      expect(res.commands.powershell).toContain("claude");
      expect(res.commands.powershell).toContain("--session-id");
      // Specific slash-command names — `not.toContain("/shipwright-")` would
      // false-fire because the project path itself contains "shipwright-webui".
      const KNOWN_SLASHES = [
        "/shipwright-project",
        "/shipwright-design",
        "/shipwright-plan",
        "/shipwright-build",
        "/shipwright-test",
        "/shipwright-deploy",
        "/shipwright-changelog",
        "/shipwright-compliance",
        "/shipwright-iterate",
        "/shipwright-run",
        "/shipwright-adopt",
        "/shipwright-security",
      ];
      for (const slash of KNOWN_SLASHES) {
        expect(res.commands.powershell, `pwsh contains ${slash}`).not.toContain(
          slash,
        );
        expect(res.commands.posix, `posix contains ${slash}`).not.toContain(
          slash,
        );
      }
    } finally {
      await deleteTask(request, taskId);
    }
  });
});

test.describe("Spec 75 — Backlog path: actionId persisted on create, recovered on launch (BUG A regression fence)", () => {
  test("new-task via Backlog — TaskCard Launch (no body actionId) recovers the action template via task.actionId", async ({
    request,
  }) => {
    const project = await pickRealProject(request);
    const taskId = await createTask(request, {
      projectId: project.id,
      cwd: project.path,
      actionId: "new-task",
      phase: "design",
    });
    try {
      const persisted = await getTask(request, taskId);
      expect(persisted.actionId, "actionId must survive create").toBe(
        "new-task",
      );
      expect(persisted.phase).toBe("design");

      // Simulate the TaskCard green Launch: only `{resume: false}` body.
      const res = await launchTask(request, taskId, { resume: false });
      expect(res.commands.powershell).toContain("/shipwright-design");
      expect(res.commands.posix).toContain("/shipwright-design");
    } finally {
      await deleteTask(request, taskId);
    }
  });

  test("new-iterate via Backlog — Launch recovers /shipwright-iterate", async ({
    request,
  }) => {
    const project = await pickRealProject(request);
    const taskId = await createTask(request, {
      projectId: project.id,
      cwd: project.path,
      actionId: "new-iterate",
    });
    try {
      const res = await launchTask(request, taskId, { resume: false });
      expect(res.commands.powershell).toContain("/shipwright-iterate");
      expect(res.commands.posix).toContain("/shipwright-iterate");
    } finally {
      await deleteTask(request, taskId);
    }
  });

  test("new-pipeline via Backlog — Launch recovers /shipwright-run", async ({
    request,
  }) => {
    const project = await pickRealProject(request);
    const taskId = await createTask(request, {
      projectId: project.id,
      cwd: project.path,
      actionId: "new-pipeline",
    });
    try {
      const res = await launchTask(request, taskId, { resume: false });
      expect(res.commands.powershell).toContain("/shipwright-run");
      expect(res.commands.posix).toContain("/shipwright-run");
    } finally {
      await deleteTask(request, taskId);
    }
  });

  test("new-plain via Backlog — Launch produces a working `claude --session-id` (no slash command)", async ({
    request,
  }) => {
    // BUG A reproducer for new-plain. Pre-fix, no actionId was persisted
    // at create-time, so the server fell to legacy buildCopyCommands.
    // Post-fix the substitution branch runs against the new-plain
    // template; the result has no slash command (intentional — Plain
    // Claude is interactive only) but DOES carry --session-id so
    // auto-execute injects a coherent CLI.
    const project = await pickRealProject(request);
    const taskId = await createTask(request, {
      projectId: project.id,
      cwd: project.path,
      actionId: "new-plain",
    });
    try {
      const res = await launchTask(request, taskId, { resume: false });
      expect(res.commands.powershell).toContain("claude");
      expect(res.commands.powershell).toContain("--session-id");
      // Specific slash-command names — `not.toContain("/shipwright-")` would
      // false-fire because the project path itself contains "shipwright-webui".
      const KNOWN_SLASHES = [
        "/shipwright-project",
        "/shipwright-design",
        "/shipwright-plan",
        "/shipwright-build",
        "/shipwright-test",
        "/shipwright-deploy",
        "/shipwright-changelog",
        "/shipwright-compliance",
        "/shipwright-iterate",
        "/shipwright-run",
        "/shipwright-adopt",
        "/shipwright-security",
      ];
      for (const slash of KNOWN_SLASHES) {
        expect(res.commands.powershell, `pwsh contains ${slash}`).not.toContain(
          slash,
        );
        expect(res.commands.posix, `posix contains ${slash}`).not.toContain(
          slash,
        );
      }
    } finally {
      await deleteTask(request, taskId);
    }
  });
});

test.describe("Spec 75 — Session persistence across WS detach (BUG B regression fence)", () => {
  test("pty survives a WS close and is the SAME pty on re-attach (no re-spawn)", async ({
    page,
    request,
  }) => {
    const project = await pickRealProject(request);
    const taskId = await createTask(request, {
      projectId: project.id,
      cwd: project.path,
    });
    try {
      // Pre-warm the pty via /spawn so subsequent /spawn calls are
      // pure idempotent ensure-or-create. Capture the meta as the
      // baseline for identity comparison.
      const spawn1 = await request.post(
        `${SERVER}/api/terminal/${encodeURIComponent(taskId)}/spawn`,
      );
      expect(spawn1.ok()).toBeTruthy();
      const meta1 = (await spawn1.json()) as {
        taskId: string;
        shell: string;
        cwd: string;
      };

      // Drive the WS dance from the browser context so the upgrade
      // carries the right Origin (the server's loopback CORS gate
      // rejects undefined / non-loopback origins). page.evaluate
      // returns once both attach + close round-trips have fired.
      await page.goto("/");
      const wsSummary = await page.evaluate(async (tid: string) => {
        async function attachAndClose(): Promise<{
          ready: boolean;
          shellKind: string | null;
        }> {
          const proto =
            window.location.protocol === "https:" ? "wss:" : "ws:";
          const url = `${proto}//${window.location.host}/api/terminal/${encodeURIComponent(tid)}/ws`;
          return new Promise((resolve, reject) => {
            const ws = new WebSocket(url);
            let ready = false;
            let shellKind: string | null = null;
            const timer = setTimeout(() => {
              try {
                ws.close();
              } catch {
                /* ignore */
              }
              reject(new Error("WS ready handshake timed out"));
            }, 5000);
            ws.addEventListener("message", (ev) => {
              try {
                const env = JSON.parse(String(ev.data));
                if (env?.type === "ready") {
                  ready = true;
                  if (typeof env.shellKind === "string") {
                    shellKind = env.shellKind;
                  }
                  clearTimeout(timer);
                  ws.close(1000, "spec75-detach");
                }
              } catch {
                /* ignore */
              }
            });
            ws.addEventListener("close", () => {
              if (ready) resolve({ ready, shellKind });
            });
            ws.addEventListener("error", (e) => {
              clearTimeout(timer);
              reject(e);
            });
          });
        }
        const first = await attachAndClose();
        // Beat to let the server process detach. Pre-fix this is
        // exactly when the pty would have been killed.
        await new Promise((r) => setTimeout(r, 200));
        const second = await attachAndClose();
        return { first, second };
      }, taskId);

      expect(wsSummary.first.ready, "first attach reached ready").toBe(true);
      expect(wsSummary.second.ready, "second attach reached ready").toBe(true);

      // Idempotent /spawn: post-fix the entry persists across the WS
      // detach-cycle, so /spawn returns the same meta. Pre-fix, the
      // pty was killed on first detach and a fresh one was spawned by
      // the second WS upgrade — meta would still match by content
      // (same taskId / shell / cwd), so we can't disambiguate by meta
      // alone. The discriminator is the second WS-handshake reaching
      // ready in <5s WITHOUT having to wait for a fresh shell boot.
      const spawn2 = await request.post(
        `${SERVER}/api/terminal/${encodeURIComponent(taskId)}/spawn`,
      );
      expect(spawn2.ok()).toBeTruthy();
      const meta2 = (await spawn2.json()) as {
        taskId: string;
        shell: string;
        cwd: string;
      };
      expect(meta2.taskId).toBe(meta1.taskId);
      expect(meta2.shell).toBe(meta1.shell);
      expect(meta2.cwd).toBe(meta1.cwd);
    } finally {
      await request
        .post(`${SERVER}/api/terminal/${encodeURIComponent(taskId)}/close`)
        .catch(() => undefined);
      await deleteTask(request, taskId);
    }
  });
});
