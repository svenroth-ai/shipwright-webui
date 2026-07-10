/*
 * gate.test.ts — GET /api/external/projects/:id/design-gate (AC1).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { makeApp, okDesignReader, PROJECT_ID } from "./_helpers.js";

let dir: string;
let designsDir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "designrev-gate-"));
  designsDir = path.join(dir, ".shipwright", "designs");
  mkdirSync(designsDir, { recursive: true });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function writeLoopState(status: string, currentPhaseTaskId: string) {
  writeFileSync(
    path.join(dir, ".shipwright", "run_loop_state.json"),
    JSON.stringify({ status, currentPhaseTaskId }),
  );
}

describe("GET /design-gate", () => {
  it("404 when the project is unknown", async () => {
    const app = makeApp(dir, { project: null });
    const res = await app.request(`/api/external/projects/${PROJECT_ID}/design-gate`);
    expect(res.status).toBe(404);
  });

  it("active=true when paused at design AND index.html exists", async () => {
    writeFileSync(path.join(designsDir, "index.html"), "<html></html>");
    writeLoopState("paused_human_gate", "ptk-design");
    const app = makeApp(dir, { reader: okDesignReader });
    const res = await app.request(`/api/external/projects/${PROJECT_ID}/design-gate`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      active: true,
      phaseTaskId: "ptk-design",
      phase: "design",
    });
  });

  it("active=false when there is no loop-state (not paused)", async () => {
    writeFileSync(path.join(designsDir, "index.html"), "<html></html>");
    const app = makeApp(dir, { reader: okDesignReader });
    const res = await app.request(`/api/external/projects/${PROJECT_ID}/design-gate`);
    expect((await res.json()).active).toBe(false);
  });

  it("active=false when paused but the viewer is absent", async () => {
    writeLoopState("paused_human_gate", "ptk-design");
    const app = makeApp(dir, { reader: okDesignReader });
    const res = await app.request(`/api/external/projects/${PROJECT_ID}/design-gate`);
    expect((await res.json()).active).toBe(false);
  });

  it("active=false when run-config is missing (no config to resolve the phase)", async () => {
    writeFileSync(path.join(designsDir, "index.html"), "<html></html>");
    writeLoopState("paused_human_gate", "ptk-design");
    const app = makeApp(dir); // default reader → status: missing
    const res = await app.request(`/api/external/projects/${PROJECT_ID}/design-gate`);
    expect((await res.json()).active).toBe(false);
  });
});
