/*
 * helpers/board-fixture.ts — seedBoard's partial-failure path.
 * When task seeding throws, the caller never receives a fixture to clean up, so
 * seedBoard must delete the project it already created (code-review fold,
 * iterate-2026-10-09-e2e-spec-fixture-hygiene). Drives the REAL seedProject /
 * seedTask against a scripted `request`, so no browser or server state is used.
 */
import type { APIRequestContext, Page } from "@playwright/test";
import { test, expect } from "@playwright/test";

import { cleanupBoard, seedBoard } from "../helpers/board-fixture";

const reply = (ok: boolean, body: unknown) => ({
  ok: () => ok,
  status: () => (ok ? 200 : 500),
  text: async () => JSON.stringify(body),
  json: async () => body,
});

function scriptedRequest(taskStatusOk: boolean) {
  const calls: string[] = [];
  const request = {
    post: async (url: string) => {
      calls.push(`POST ${url}`);
      if (url.endsWith("/api/projects")) return reply(true, { data: { id: "p-scripted" } });
      return taskStatusOk
        ? reply(true, { task: { taskId: "t-scripted", sessionUuid: "u" } })
        : reply(false, { error: "boom" });
    },
    patch: async () => reply(true, {}),
    delete: async (url: string) => {
      calls.push(`DELETE ${url}`);
      return reply(true, {});
    },
  };
  return { request: request as unknown as APIRequestContext, calls };
}

// A page stand-in: setActiveProject only calls page.addInitScript.
const page = { addInitScript: async () => undefined } as unknown as Page;

test.describe("seedBoard partial failure", () => {
  // @covers FR-01.01
  test("deletes the already-created project when the task cannot be seeded", async () => {
    const { request, calls } = scriptedRequest(false);
    await expect(seedBoard(page, request, "partial")).rejects.toThrow(/seedTask/);
    expect(calls.some((c) => c.startsWith("DELETE") && c.includes("p-scripted"))).toBe(true);
  });

  // @covers FR-01.01
  test("keeps the project when both seeds succeed", async () => {
    const { request, calls } = scriptedRequest(true);
    const board = await seedBoard(page, request, "ok");
    expect(board.project.projectId).toBe("p-scripted");
    expect(board.task.taskId).toBe("t-scripted");
    expect(calls.some((c) => c.startsWith("DELETE"))).toBe(false);
    await cleanupBoard(request, board); // removes the temp dirs the real seeders created
  });
});
