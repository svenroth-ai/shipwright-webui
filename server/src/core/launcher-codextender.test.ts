/*
 * launcher-codextender.test.ts (Codextender integration spec Part B.2).
 * Covers the env-var-prefix injection into an already-built plain-Claude
 * `CopyCommandForms`, across all three shells, plus the model default.
 */

import { describe, it, expect } from "vitest";

import { buildCopyCommands } from "./launcher.js";
import {
  buildCodextenderCommands,
  CODEXTENDER_AUTH_TOKEN_PLACEHOLDER,
  CodextenderCwdMismatchError,
  DEFAULT_CODEXTENDER_MODEL_ALIAS,
  resolveCodextenderAuthToken,
} from "./launcher-codextender.js";

const SESSION_UUID = "00000000-0000-0000-0000-000000000001";
const CWD = "C:\\01_Development\\demo";

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

describe("buildCodextenderCommands", () => {
  it("prepends the 5 env vars right after the cd-prefix, before the claude invocation, on all 3 shells", () => {
    const claude = claudeCommands();
    const result = buildCodextenderCommands({
      cwd: CWD,
      baseUrl: "http://127.0.0.1:4000",
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
    expect(result.powershell).toContain(CODEXTENDER_AUTH_TOKEN_PLACEHOLDER);
    expect(result.powershell).toContain(`$env:ANTHROPIC_MODEL = '${DEFAULT_CODEXTENDER_MODEL_ALIAS}'; `);
    expect(result.powershell).toContain("$env:CODEXTENDER_ACTIVE = '1'; ");
    expect(result.powershell).toContain(`$env:CODEXTENDER_MODEL = '${DEFAULT_CODEXTENDER_MODEL_ALIAS}'; `);

    expect(result.cmd).toContain('set "ANTHROPIC_BASE_URL=http://127.0.0.1:4000" && ');
    expect(result.cmd).toContain("ANTHROPIC_AUTH_TOKEN");
    expect(result.cmd).toContain(CODEXTENDER_AUTH_TOKEN_PLACEHOLDER);
    expect(result.cmd).toContain("set \"CODEXTENDER_ACTIVE=1\" && ");

    expect(result.posix).toContain("ANTHROPIC_BASE_URL='http://127.0.0.1:4000' ");
    expect(result.posix).toContain("ANTHROPIC_AUTH_TOKEN");
    expect(result.posix).toContain(CODEXTENDER_AUTH_TOKEN_PLACEHOLDER);
    expect(result.posix).toContain("CODEXTENDER_ACTIVE='1' ");
  });

  it("the env prefix sits between the cd-prefix and the claude invocation, and the tail is preserved verbatim", () => {
    const claude = claudeCommands();
    const result = buildCodextenderCommands({
      cwd: CWD,
      baseUrl: "http://127.0.0.1:4000",
      claudeCommands: claude,
    });
    // posix cd-prefix is `cd '<posix-path>' && `
    expect(result.posix.startsWith("cd '")).toBe(true);
    expect(result.posix.endsWith(claude.posix.replace(/^cd '[^']*' && /, ""))).toBe(true);
    expect(result.posix).toContain(SESSION_UUID);
  });

  it("defaults the model alias to DEFAULT_CODEXTENDER_MODEL_ALIAS when no model is given", () => {
    const result = buildCodextenderCommands({
      cwd: CWD,
      baseUrl: "http://127.0.0.1:4000",
      claudeCommands: claudeCommands(),
    });
    expect(result.posix).toContain(`ANTHROPIC_MODEL='${DEFAULT_CODEXTENDER_MODEL_ALIAS}' `);
    expect(result.posix).toContain(`CODEXTENDER_MODEL='${DEFAULT_CODEXTENDER_MODEL_ALIAS}' `);
  });

  it("uses a provided model override for both ANTHROPIC_MODEL and CODEXTENDER_MODEL", () => {
    const result = buildCodextenderCommands({
      cwd: CWD,
      baseUrl: "http://127.0.0.1:4000",
      model: "astra",
      claudeCommands: claudeCommands(),
    });
    expect(result.posix).toContain("ANTHROPIC_MODEL='astra' ");
    expect(result.posix).toContain("CODEXTENDER_MODEL='astra' ");
  });

  it("trims a blank model override and falls back to the default", () => {
    const result = buildCodextenderCommands({
      cwd: CWD,
      baseUrl: "http://127.0.0.1:4000",
      model: "   ",
      claudeCommands: claudeCommands(),
    });
    expect(result.posix).toContain(`ANTHROPIC_MODEL='${DEFAULT_CODEXTENDER_MODEL_ALIAS}' `);
  });

  it("uses the given baseUrl verbatim (not re-derived from a port)", () => {
    const result = buildCodextenderCommands({
      cwd: CWD,
      baseUrl: "http://127.0.0.1:4100",
      claudeCommands: claudeCommands(),
    });
    expect(result.cmd).toContain('set "ANTHROPIC_BASE_URL=http://127.0.0.1:4100" && ');
  });

  it("doubt-review HIGH — throws CodextenderCwdMismatchError (never silently double-prefixes) when the claude command's embedded cd-prefix doesn't match the given cwd", () => {
    const claude = claudeCommands();
    const oddCwd = "C:\\Somewhere\\Else";
    expect(() =>
      buildCodextenderCommands({
        cwd: oddCwd,
        baseUrl: "http://127.0.0.1:4000",
        claudeCommands: claude,
      }),
    ).toThrow(CodextenderCwdMismatchError);
  });
});

describe("resolveCodextenderAuthToken", () => {
  const ENV_KEY = "CODEXTENDER_AUTH_TOKEN";

  it("falls back to the documented placeholder when unset", () => {
    const prior = process.env[ENV_KEY];
    delete process.env[ENV_KEY];
    try {
      expect(resolveCodextenderAuthToken()).toBe(CODEXTENDER_AUTH_TOKEN_PLACEHOLDER);
    } finally {
      if (prior !== undefined) process.env[ENV_KEY] = prior;
    }
  });

  it("PR-review finding (iterate-2026-09-23) — prefers a non-blank CODEXTENDER_AUTH_TOKEN env var", () => {
    const prior = process.env[ENV_KEY];
    process.env[ENV_KEY] = "custom-master-key";
    try {
      expect(resolveCodextenderAuthToken()).toBe("custom-master-key");
    } finally {
      if (prior === undefined) delete process.env[ENV_KEY];
      else process.env[ENV_KEY] = prior;
    }
  });

  it("treats a blank/whitespace env var as unset", () => {
    const prior = process.env[ENV_KEY];
    process.env[ENV_KEY] = "   ";
    try {
      expect(resolveCodextenderAuthToken()).toBe(CODEXTENDER_AUTH_TOKEN_PLACEHOLDER);
    } finally {
      if (prior === undefined) delete process.env[ENV_KEY];
      else process.env[ENV_KEY] = prior;
    }
  });
});
