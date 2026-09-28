/*
 * launcher-codextender.auto-mode-server.test.ts — operator finding
 * (2026-09-27): every gateway-routed session (which a Codextender launch
 * always is) shows a recurring "auto mode isn't eligible for classifier
 * billing changes" notice on every classifier-gated action, because Claude
 * Code detects the non-Anthropic base URL. Cosmetic (billing unaffected
 * either way), but re-fires for the life of the session. Covers
 * `buildCodextenderCommands` setting `CLAUDE_CODE_AUTO_MODE_SERVER=0` to
 * suppress it — split out of launcher-codextender.test.ts (bloat
 * anti-ratchet) as its own concern, same pattern as the sibling
 * max-context-tokens test file.
 */

import { readFileSync, unlinkSync } from "node:fs";

import { describe, it, expect } from "vitest";

import { buildCopyCommands } from "./launcher.js";
import { buildCodextenderCommands } from "./launcher-codextender.js";

const SESSION_UUID = "00000000-0000-0000-0000-000000000001";
const CWD = "C:\\01_Development\\demo";
const FIXTURE_MASTER_KEY = "test-master-key";

function claudeCommands() {
  return buildCopyCommands({
    sessionUuid: SESSION_UUID,
    cwd: CWD,
    resume: false,
    fork: false,
    pluginDirs: [],
    title: "demo task",
  });
}

/** Same extraction idiom as the sibling test files — the auth token is never
 *  a literal in any generated command, only its temp-file path is. */
function readAndDeleteTokenFile(command: string, shellForm: "powershell" | "cmd" | "posix"): string {
  let filePath: string;
  if (shellForm === "powershell") {
    const m = command.match(/Get-Content -LiteralPath '([^']+)'/);
    if (!m) throw new Error("token file path not found in powershell command");
    filePath = m[1];
  } else if (shellForm === "cmd") {
    const m = command.match(/set \/p ANTHROPIC_AUTH_TOKEN=<"([^"]+)"/);
    if (!m) throw new Error("token file path not found in cmd command");
    filePath = m[1];
  } else {
    const m = command.match(/\$\(cat '([^']+)'\)/);
    if (!m) throw new Error("token file path not found in posix command");
    filePath = m[1];
  }
  const content = readFileSync(filePath, "utf8").trimEnd();
  unlinkSync(filePath);
  return content;
}

describe("buildCodextenderCommands — CLAUDE_CODE_AUTO_MODE_SERVER", () => {
  it("operator finding (2026-09-27) — unconditionally sets CLAUDE_CODE_AUTO_MODE_SERVER=0 on all 3 shells, regardless of maxContextTokens", () => {
    const result = buildCodextenderCommands({
      cwd: CWD,
      baseUrl: "http://127.0.0.1:4000",
      authToken: FIXTURE_MASTER_KEY,
      claudeCommands: claudeCommands(),
    });
    expect(result.powershell).toContain("$env:CLAUDE_CODE_AUTO_MODE_SERVER = '0'; ");
    expect(result.cmd).toContain('set "CLAUDE_CODE_AUTO_MODE_SERVER=0" && ');
    expect(result.posix).toContain("CLAUDE_CODE_AUTO_MODE_SERVER='0' ");
    readAndDeleteTokenFile(result.posix, "posix");
  });

  it("still sets CLAUDE_CODE_AUTO_MODE_SERVER=0 when maxContextTokens is also given, and cleans up both vars after", () => {
    const result = buildCodextenderCommands({
      cwd: CWD,
      baseUrl: "http://127.0.0.1:4000",
      authToken: FIXTURE_MASTER_KEY,
      claudeCommands: claudeCommands(),
      maxContextTokens: 1_050_000,
    });
    expect(result.posix).toContain("CLAUDE_CODE_AUTO_MODE_SERVER='0' ");
    expect(result.posix).toContain("CLAUDE_CODE_MAX_CONTEXT_TOKENS='1050000' ");

    // Cleanup suffix drops both on all 3 shells — neither may outlive this
    // one `claude` invocation in the long-lived pty shell (a later
    // Relaunch-as-Claude/Codex-Light in the same tab must not inherit
    // either).
    expect(result.powershell.trimEnd()).toContain("Env:CLAUDE_CODE_AUTO_MODE_SERVER");
    expect(result.cmd.trimEnd()).toContain(" & set CLAUDE_CODE_AUTO_MODE_SERVER=");
    readAndDeleteTokenFile(result.posix, "posix");
  });

  it("never emits the literal auth-token value alongside CLAUDE_CODE_AUTO_MODE_SERVER (no accidental adjacency/quoting bug)", () => {
    const result = buildCodextenderCommands({
      cwd: CWD,
      baseUrl: "http://127.0.0.1:4000",
      authToken: "another-fixture-value",
      claudeCommands: claudeCommands(),
    });
    expect(result.powershell).not.toContain("another-fixture-value");
    expect(result.cmd).not.toContain("another-fixture-value");
    expect(result.posix).not.toContain("another-fixture-value");
    expect(result.posix).toContain("CLAUDE_CODE_AUTO_MODE_SERVER='0' ");
    readAndDeleteTokenFile(result.posix, "posix");
  });
});
