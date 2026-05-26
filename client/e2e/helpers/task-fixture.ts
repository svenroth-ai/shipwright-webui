/*
 * Small task-fixture helpers for E2E specs that need an isolated task
 * with a real (temp) cwd. Extracted from C5 spec to stay under the
 * 300-LOC file ceiling.
 *
 * Pattern mirrors `client/e2e/flows/74-auto-launch-disk-persistence.spec.ts`
 * — `fs.mkdtemp` for the cwd + a retry-tolerant `cleanupCwd` (Windows
 * occasionally holds an EBUSY on the tmp dir for a few ms after the
 * pty exits).
 */

import type { APIRequestContext } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export async function makeTaskCwd(prefix = "iterate-e2e-"): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

export async function cleanupCwd(dir: string): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await fs.rm(dir, { recursive: true, force: true });
      return;
    } catch {
      if (attempt === 4) return;
      await new Promise((r) => setTimeout(r, 250));
    }
  }
}

export async function createTask(
  request: APIRequestContext,
  cwd: string,
  title: string,
): Promise<string> {
  const res = await request.post("/api/external/tasks", {
    data: { title, cwd },
  });
  if (!res.ok()) {
    throw new Error(
      `POST /api/external/tasks: HTTP ${res.status()} — ${await res.text()}`,
    );
  }
  const body = (await res.json()) as { task: { taskId: string } };
  return body.task.taskId;
}

export async function cleanupTask(
  request: APIRequestContext,
  taskId: string,
): Promise<void> {
  if (!taskId) return;
  try {
    await request.delete(`/api/external/tasks/${encodeURIComponent(taskId)}`);
  } catch {
    /* ignore */
  }
}
