/*
 * launcher-codextender.max-context-tokens.test.ts — operator finding
 * (2026-09-26): Claude Code assumes a 200K context window for any model id
 * it doesn't recognize (the Codex alias) and over-compacts against that
 * wrong ceiling. Covers `buildCodextenderCommands`'s `maxContextTokens`
 * plumbing into `CLAUDE_CODE_MAX_CONTEXT_TOKENS` — split out of
 * launcher-codextender.test.ts (bloat anti-ratchet) as its own concern.
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

/** Same extraction idiom as launcher-codextender.test.ts's own helper — the
 *  auth token is never a literal in any generated command, only its
 *  temp-file path is, so tests must read (and clean up) that file. */
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

describe("buildCodextenderCommands — CLAUDE_CODE_MAX_CONTEXT_TOKENS", () => {
  it("operator finding (2026-09-26) — omits CLAUDE_CODE_MAX_CONTEXT_TOKENS entirely when maxContextTokens is not given", () => {
    const result = buildCodextenderCommands({
      cwd: CWD,
      baseUrl: "http://127.0.0.1:4000",
      authToken: FIXTURE_MASTER_KEY,
      claudeCommands: claudeCommands(),
    });
    for (const shellForm of ["powershell", "cmd", "posix"] as const) {
      expect(result[shellForm]).not.toContain("CLAUDE_CODE_MAX_CONTEXT_TOKENS");
    }
    readAndDeleteTokenFile(result.posix, "posix");
  });

  it("operator finding (2026-09-26) — sets CLAUDE_CODE_MAX_CONTEXT_TOKENS from the probed Codex window on all 3 shells, and cleans it up after", () => {
    const result = buildCodextenderCommands({
      cwd: CWD,
      baseUrl: "http://127.0.0.1:4000",
      authToken: FIXTURE_MASTER_KEY,
      claudeCommands: claudeCommands(),
      maxContextTokens: 1_050_000,
    });

    expect(result.powershell).toContain("$env:CLAUDE_CODE_MAX_CONTEXT_TOKENS = '1050000'; ");
    expect(result.cmd).toContain('set "CLAUDE_CODE_MAX_CONTEXT_TOKENS=1050000" && ');
    expect(result.posix).toContain("CLAUDE_CODE_MAX_CONTEXT_TOKENS='1050000' ");

    // Cleanup suffix drops the var on all 3 shells too — it must not
    // outlive this one `claude` invocation in the long-lived pty shell.
    expect(result.powershell.trimEnd()).toMatch(
      /; Remove-Item Env:ANTHROPIC_BASE_URL,Env:ANTHROPIC_AUTH_TOKEN,Env:ANTHROPIC_MODEL,Env:CODEXTENDER_ACTIVE,Env:CODEXTENDER_MODEL,Env:CLAUDE_CODE_MAX_CONTEXT_TOKENS -ErrorAction SilentlyContinue/,
    );
    expect(result.cmd.trimEnd()).toMatch(
      / & set ANTHROPIC_BASE_URL= & set ANTHROPIC_AUTH_TOKEN= & set ANTHROPIC_MODEL= & set CODEXTENDER_ACTIVE= & set CODEXTENDER_MODEL= & set CLAUDE_CODE_MAX_CONTEXT_TOKENS= & del/,
    );
    readAndDeleteTokenFile(result.posix, "posix");
  });
});
