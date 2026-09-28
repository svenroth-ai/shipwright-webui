/*
 * launcher-codextender.tier-aliases.test.ts — Claude Code resolves the tier
 * aliases opus/sonnet/haiku to `claude-*` names and sends them to
 * ANTHROPIC_BASE_URL, but the Codextender proxy serves only the Codex alias
 * it was started with (no claude-* wildcards). A Codextender launch therefore
 * pins ANTHROPIC_DEFAULT_{OPUS,SONNET,HAIKU}_MODEL to the launch alias, and
 * the cleanup suffix removes them so they never leak into the long-lived pty.
 */

import { readFileSync, unlinkSync } from "node:fs";

import { describe, it, expect } from "vitest";

import { buildCopyCommands } from "./launcher.js";
import { DEFAULT_CODEXTENDER_MODEL_ALIAS, buildCodextenderCommands } from "./launcher-codextender.js";

const CWD = "C:/demo";

const TIER_VARS = [
  "ANTHROPIC_DEFAULT_OPUS_MODEL",
  "ANTHROPIC_DEFAULT_SONNET_MODEL",
  "ANTHROPIC_DEFAULT_HAIKU_MODEL",
] as const;

function build(model?: string) {
  const result = buildCodextenderCommands({
    cwd: CWD,
    baseUrl: "http://127.0.0.1:4000",
    model,
    authToken: "test-master-key",
    claudeCommands: buildCopyCommands({
      sessionUuid: "00000000-0000-0000-0000-000000000001",
      cwd: CWD,
      resume: false,
      fork: false,
      pluginDirs: [],
      title: "demo task",
    }),
  });
  // The token temp file is created per build; remove it.
  const m = result.posix.match(/\$\(cat '([^']+)'\)/);
  if (m) {
    readFileSync(m[1], "utf8");
    unlinkSync(m[1]);
  }
  return result;
}

describe("buildCodextenderCommands — tier aliases", () => {
  for (const alias of [DEFAULT_CODEXTENDER_MODEL_ALIAS, "astra"]) {
    it(`pins all three tier vars to the launch alias '${alias}' on all 3 shells, and cleans them up`, () => {
      const result = build(alias === DEFAULT_CODEXTENDER_MODEL_ALIAS ? undefined : alias);
      for (const name of TIER_VARS) {
        expect(result.powershell).toContain(`$env:${name} = '${alias}'; `);
        expect(result.cmd).toContain(`set "${name}=${alias}" && `);
        expect(result.posix).toContain(`${name}='${alias}' `);
        expect(result.powershell.trimEnd()).toContain(`Env:${name}`);
        expect(result.cmd.trimEnd()).toContain(` & set ${name}=`);
      }
    });
  }

  it("trims a padded model alias before pinning the tier vars", () => {
    const result = build("  astra  ");
    for (const name of TIER_VARS) {
      expect(result.posix).toContain(`${name}='astra' `);
      expect(result.powershell).toContain(`$env:${name} = 'astra'; `);
    }
  });

  it("never sets CLAUDE_CODE_SUBAGENT_MODEL (subagent frontmatter outranks it)", () => {
    const result = build();
    for (const shell of ["powershell", "cmd", "posix"] as const) {
      expect(result[shell]).not.toContain("CLAUDE_CODE_SUBAGENT_MODEL");
    }
  });
});
