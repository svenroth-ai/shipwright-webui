import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { detectRemoteControl } from "./remote-control.js";

const SESSION = "11111111-2222-3333-4444-555555555555";
const dirs: string[] = [];

function sessionsDir(files: Record<string, string>): string {
  const dir = mkdtempSync(path.join(tmpdir(), "rc-sessions-"));
  dirs.push(dir);
  for (const [name, body] of Object.entries(files)) writeFileSync(path.join(dir, name), body);
  return dir;
}

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("detectRemoteControl - non-object session files", () => {
  it("skips files holding valid JSON that is not an object instead of throwing", async () => {
    const dir = sessionsDir({
      "1.json": "null",
      "2.json": "[1,2]",
      "3.json": "42",
      "4.json": "\"text\"",
      "4242.json": JSON.stringify({ pid: 4242, sessionId: SESSION, bridgeSessionId: "session_x" }),
    });
    const rc = await detectRemoteControl(SESSION, false, { sessionsDir: dir, isPidAlive: (p) => p === 4242 });
    expect(rc).toEqual({ active: true, onceEnabled: true, pid: 4242 });
  });

  it("returns inactive (not a throw) when the only file is JSON null", async () => {
    const dir = sessionsDir({ "9.json": "null" });
    await expect(detectRemoteControl(SESSION, false, { sessionsDir: dir, isPidAlive: () => true })).resolves.toEqual({
      active: false,
      onceEnabled: false,
      pid: null,
    });
  });
});
