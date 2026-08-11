import assert from "node:assert/strict";
import test from "node:test";
import {
  contaminatingUnassignedTasks,
  fixturePath,
  isolatedPlaywrightEnv,
} from "../e2e/isolated-stack.mjs";

test("fixturePath detects temporary E2E paths, repository fixtures, and worktrees", () => {
  assert.equal(fixturePath("C:/Temp/sw-e2e-task-123", "C:/Temp"), true);
  assert.equal(fixturePath("C:/Temp/auto-launch-e2e-123", "C:/Temp"), true);
  assert.equal(fixturePath("C:/tmp/transcript-e2e", "C:/Temp"), true);
  assert.equal(fixturePath(process.cwd(), "C:/Temp"), true);
  assert.equal(fixturePath("C:/repo/.worktrees/e2e-run"), true);
  assert.equal(fixturePath("C:/Users/operator/project", "C:/Temp"), false);
});

test("isolated child environment overwrites live API escape hatches", () => {
  const env = isolatedPlaywrightEnv(
    {
      API_BASE_URL: "http://127.0.0.1:3847",
      WEBUI_API_URL: "http://127.0.0.1:3847",
      BASE_URL: "http://127.0.0.1:5173",
    },
    "http://127.0.0.1:62024",
    62023,
    62024,
  );
  assert.equal(env.BASE_URL, "http://127.0.0.1:62024");
  assert.equal(env.API_BASE_URL, "http://127.0.0.1:62024");
  assert.equal(env.WEBUI_API_URL, "http://127.0.0.1:62024");
});

test("contamination guard only rejects unassigned fixture tasks", () => {
  const leaks = contaminatingUnassignedTasks({
    sessions: {
      leaked: { projectId: "unassigned", cwd: "C:/Temp/sw-e2e-task-123" },
      transcript: { projectId: "unassigned", cwd: "C:/tmp/transcript-e2e" },
      assigned: { projectId: "project-a", cwd: "C:/Temp/sw-e2e-task-456" },
      operator: { projectId: "unassigned", cwd: "C:/Users/operator/project" },
    },
  }, "C:/Temp");
  assert.deepEqual(leaks.map((task) => task.cwd), [
    "C:/Temp/sw-e2e-task-123",
    "C:/tmp/transcript-e2e",
  ]);
});
