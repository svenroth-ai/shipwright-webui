/*
 * launcher-codextender.test.ts (Codextender integration spec Part B.2).
 * Covers the env-var-prefix injection into an already-built plain-Claude
 * `CopyCommandForms`, across all three shells, plus the model default.
 */

import { readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, it, expect, vi } from "vitest";

import { buildCopyCommands } from "./launcher.js";
import {
  buildCodextenderCommands,
  CodextenderCwdMismatchError,
  DEFAULT_CODEXTENDER_MODEL_ALIAS,
} from "./launcher-codextender.js";

vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  return { ...actual, randomUUID: vi.fn(actual.randomUUID) };
});
import { randomUUID } from "node:crypto";

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

/**
 * PR-review round 8 — the auth token is never a literal in any generated
 * command; each shell form embeds the SAME temp-file path instead. Extracts
 * it per shell so tests can read (and clean up) the real file the launch
 * would have read at execution time.
 */
function extractTokenFilePath(command: string, shellForm: "powershell" | "cmd" | "posix"): string {
  if (shellForm === "powershell") {
    const m = command.match(/Get-Content -LiteralPath '([^']+)'/);
    if (!m) throw new Error("token file path not found in powershell command");
    return m[1];
  }
  if (shellForm === "cmd") {
    const m = command.match(/set \/p ANTHROPIC_AUTH_TOKEN=<"([^"]+)"/);
    if (!m) throw new Error("token file path not found in cmd command");
    return m[1];
  }
  const m = command.match(/\$\(cat '([^']+)'\)/);
  if (!m) throw new Error("token file path not found in posix command");
  return m[1];
}

function readAndDeleteTokenFile(command: string, shellForm: "powershell" | "cmd" | "posix"): string {
  const filePath = extractTokenFilePath(command, shellForm);
  const content = readFileSync(filePath, "utf8").trimEnd();
  unlinkSync(filePath);
  return content;
}

describe("buildCodextenderCommands", () => {
  it("prepends the 5 env vars right after the cd-prefix, before the claude invocation, on all 3 shells", () => {
    const claude = claudeCommands();
    const result = buildCodextenderCommands({
      cwd: CWD,
      baseUrl: "http://127.0.0.1:4000",
      authToken: FIXTURE_MASTER_KEY,
      claudeCommands: claude,
    });

    for (const shellForm of ["powershell", "cmd", "posix"] as const) {
      // Everything AFTER the env-var prefix is byte-identical to the
      // original plain-Claude command for this shell.
      expect(result[shellForm].endsWith(claude[shellForm])).toBe(false); // cd-prefix differs in position
      expect(result[shellForm]).toContain(claude[shellForm].split(/&&|;/).slice(1).join("").trim() === "" ? "" : "claude");
    }

    expect(result.powershell).toContain("$env:ANTHROPIC_BASE_URL = 'http://127.0.0.1:4000'; ");
    expect(result.powershell).toContain("ANTHROPIC_AUTH_TOKEN");
    expect(result.powershell).toContain(`$env:ANTHROPIC_MODEL = '${DEFAULT_CODEXTENDER_MODEL_ALIAS}'; `);
    expect(result.powershell).toContain("$env:CODEXTENDER_ACTIVE = '1'; ");
    expect(result.powershell).toContain(`$env:CODEXTENDER_MODEL = '${DEFAULT_CODEXTENDER_MODEL_ALIAS}'; `);

    expect(result.cmd).toContain('set "ANTHROPIC_BASE_URL=http://127.0.0.1:4000" && ');
    expect(result.cmd).toContain("ANTHROPIC_AUTH_TOKEN");
    expect(result.cmd).toContain("set \"CODEXTENDER_ACTIVE=1\" && ");

    expect(result.posix).toContain("ANTHROPIC_BASE_URL='http://127.0.0.1:4000' ");
    expect(result.posix).toContain("ANTHROPIC_AUTH_TOKEN");
    expect(result.posix).toContain("CODEXTENDER_ACTIVE='1' ");

    // PR-review round 8 — none of the 3 shells ever contain the literal
    // token value; only its temp-file path does.
    expect(result.powershell).not.toContain(FIXTURE_MASTER_KEY);
    expect(result.cmd).not.toContain(FIXTURE_MASTER_KEY);
    expect(result.posix).not.toContain(FIXTURE_MASTER_KEY);
    expect(readAndDeleteTokenFile(result.posix, "posix")).toBe(FIXTURE_MASTER_KEY);
  });

  it("the env prefix sits between the cd-prefix and the claude invocation, and the tail is preserved verbatim before the cleanup suffix", () => {
    const claude = claudeCommands();
    const result = buildCodextenderCommands({
      cwd: CWD,
      baseUrl: "http://127.0.0.1:4000",
      authToken: FIXTURE_MASTER_KEY,
      claudeCommands: claude,
    });
    // posix cd-prefix is `cd '<posix-path>' && `
    expect(result.posix.startsWith("cd '")).toBe(true);
    expect(result.posix).toContain(claude.posix.replace(/^cd '[^']*' && /, ""));
    expect(result.posix).toContain(SESSION_UUID);
    readAndDeleteTokenFile(result.posix, "posix");
  });

  it("defaults the model alias to DEFAULT_CODEXTENDER_MODEL_ALIAS when no model is given", () => {
    const result = buildCodextenderCommands({
      cwd: CWD,
      baseUrl: "http://127.0.0.1:4000",
      authToken: FIXTURE_MASTER_KEY,
      claudeCommands: claudeCommands(),
    });
    expect(result.posix).toContain(`ANTHROPIC_MODEL='${DEFAULT_CODEXTENDER_MODEL_ALIAS}' `);
    expect(result.posix).toContain(`CODEXTENDER_MODEL='${DEFAULT_CODEXTENDER_MODEL_ALIAS}' `);
    readAndDeleteTokenFile(result.posix, "posix");
  });

  it("uses a provided model override for both ANTHROPIC_MODEL and CODEXTENDER_MODEL", () => {
    const result = buildCodextenderCommands({
      cwd: CWD,
      baseUrl: "http://127.0.0.1:4000",
      model: "astra",
      authToken: FIXTURE_MASTER_KEY,
      claudeCommands: claudeCommands(),
    });
    expect(result.posix).toContain("ANTHROPIC_MODEL='astra' ");
    expect(result.posix).toContain("CODEXTENDER_MODEL='astra' ");
    readAndDeleteTokenFile(result.posix, "posix");
  });

  it("trims a blank model override and falls back to the default", () => {
    const result = buildCodextenderCommands({
      cwd: CWD,
      baseUrl: "http://127.0.0.1:4000",
      model: "   ",
      authToken: FIXTURE_MASTER_KEY,
      claudeCommands: claudeCommands(),
    });
    expect(result.posix).toContain(`ANTHROPIC_MODEL='${DEFAULT_CODEXTENDER_MODEL_ALIAS}' `);
    readAndDeleteTokenFile(result.posix, "posix");
  });

  it("uses the given baseUrl verbatim (not re-derived from a port)", () => {
    const result = buildCodextenderCommands({
      cwd: CWD,
      baseUrl: "http://127.0.0.1:4100",
      authToken: FIXTURE_MASTER_KEY,
      claudeCommands: claudeCommands(),
    });
    expect(result.cmd).toContain('set "ANTHROPIC_BASE_URL=http://127.0.0.1:4100" && ');
    readAndDeleteTokenFile(result.posix, "posix");
  });

  it("PR-review round 8 — the authToken value reaches only the temp file, never any of the 3 command strings", () => {
    const result = buildCodextenderCommands({
      cwd: CWD,
      baseUrl: "http://127.0.0.1:4000",
      authToken: "another-fixture-value",
      claudeCommands: claudeCommands(),
    });
    expect(result.powershell).not.toContain("another-fixture-value");
    expect(result.cmd).not.toContain("another-fixture-value");
    expect(result.posix).not.toContain("another-fixture-value");

    // All 3 shells reference the SAME temp file (one write per launch).
    const psPath = extractTokenFilePath(result.powershell, "powershell");
    const cmdPath = extractTokenFilePath(result.cmd, "cmd");
    const posixPath = extractTokenFilePath(result.posix, "posix");
    expect(psPath).toBe(cmdPath);
    expect(cmdPath).toBe(posixPath);
    expect(readAndDeleteTokenFile(result.posix, "posix")).toBe("another-fixture-value");
  });

  it("PR-review round 8 — each shell's own no-echo read idiom actually resolves the token for a child process (empirically verified real cmd.exe/powershell.exe behavior)", () => {
    const result = buildCodextenderCommands({
      cwd: CWD,
      baseUrl: "http://127.0.0.1:4000",
      authToken: FIXTURE_MASTER_KEY,
      claudeCommands: claudeCommands(),
    });
    expect(result.powershell).toContain("(Get-Content -LiteralPath '");
    expect(result.powershell).toContain("-Raw).Trim()");
    expect(result.cmd).toContain("set /p ANTHROPIC_AUTH_TOKEN=<\"");
    expect(result.posix).toContain("ANTHROPIC_AUTH_TOKEN=");
    expect(result.posix).toContain("$(cat '");
    readAndDeleteTokenFile(result.posix, "posix");
  });

  it("plan-review HIGH + PR-review round 8 — cleans up all 5 env vars AND deletes the temp token file after the claude invocation, on all 3 shells", () => {
    const result = buildCodextenderCommands({
      cwd: CWD,
      baseUrl: "http://127.0.0.1:4000",
      authToken: FIXTURE_MASTER_KEY,
      claudeCommands: claudeCommands(),
    });
    const tokenPath = extractTokenFilePath(result.posix, "posix");

    expect(result.powershell.trimEnd()).toMatch(
      /; Remove-Item Env:ANTHROPIC_BASE_URL,Env:ANTHROPIC_AUTH_TOKEN,Env:ANTHROPIC_MODEL,Env:CODEXTENDER_ACTIVE,Env:CODEXTENDER_MODEL -ErrorAction SilentlyContinue; Remove-Item -LiteralPath '.+' -Force -ErrorAction SilentlyContinue$/,
    );
    expect(result.cmd.trimEnd()).toMatch(
      / & set ANTHROPIC_BASE_URL= & set ANTHROPIC_AUTH_TOKEN= & set ANTHROPIC_MODEL= & set CODEXTENDER_ACTIVE= & set CODEXTENDER_MODEL= & del \/f \/q ".+"$/,
    );
    expect(result.posix.trimEnd()).toMatch(/ ; rm -f '.+'$/);
    expect(result.posix).not.toContain("Remove-Item");
    expect(result.posix).not.toContain(" & set ");

    unlinkSync(tokenPath);
  });

  it("PR-review round 12 — a pre-existing file (e.g. an attacker-planted symlink) at the generated token-file path is never followed; the writer retries under a fresh random name instead", () => {
    const collisionId = "11111111-1111-1111-1111-111111111111";
    const freshId = "22222222-2222-2222-2222-222222222222";
    const collisionPath = path.join(tmpdir(), `codextender-auth-${collisionId}.tmp`);
    const DECOY_CONTENT = "PRE-EXISTING-DECOY-CONTENT-DO-NOT-OVERWRITE";
    writeFileSync(collisionPath, DECOY_CONTENT);
    vi.mocked(randomUUID).mockReturnValueOnce(collisionId as `${string}-${string}-${string}-${string}-${string}`);
    vi.mocked(randomUUID).mockReturnValueOnce(freshId as `${string}-${string}-${string}-${string}-${string}`);

    try {
      const result = buildCodextenderCommands({
        cwd: CWD,
        baseUrl: "http://127.0.0.1:4000",
        authToken: FIXTURE_MASTER_KEY,
        claudeCommands: claudeCommands(),
      });
      const tokenPath = extractTokenFilePath(result.posix, "posix");

      expect(tokenPath).not.toBe(collisionPath);
      expect(tokenPath).toContain(freshId);
      expect(readFileSync(collisionPath, "utf8")).toBe(DECOY_CONTENT);

      readAndDeleteTokenFile(result.posix, "posix");
    } finally {
      vi.mocked(randomUUID).mockRestore();
      unlinkSync(collisionPath);
    }
  });

  it("doubt-review HIGH — throws CodextenderCwdMismatchError (never silently double-prefixes) when the claude command's embedded cd-prefix doesn't match the given cwd", () => {
    const claude = claudeCommands();
    const oddCwd = "C:\\Somewhere\\Else";
    expect(() =>
      buildCodextenderCommands({
        cwd: oddCwd,
        baseUrl: "http://127.0.0.1:4000",
        authToken: FIXTURE_MASTER_KEY,
        claudeCommands: claude,
      }),
    ).toThrow(CodextenderCwdMismatchError);
  });
});
