/*
 * {task.initial_prompt} for CUSTOM actions via slash_command.
 * iterate-2026-06-11-custom-action-slash-command (AC-1..AC-4, AC-6, AC-7).
 *
 * A custom (non-builtin) actionId fuses its declared slash_command +
 * (autonomy) + (params) + flattened description into ONE shell-quoted
 * positional, so the Claude CLI's single `[prompt]` argument receives both
 * the slash command AND the description. Without a valid slash_command a
 * custom id still throws UnknownActionError (fail-loud backstop).
 *
 * Split out of actions-substitute.test.ts to keep that file under its
 * bloat baseline.
 */

import { describe, it, expect } from "vitest";

import {
  substitutePlaceholders,
  validateTemplate,
  UnknownActionError,
  type SubstitutionContext,
} from "./actions-substitute.js";

function baseCtx(): SubstitutionContext {
  return {
    project: { id: "proj-123", path: "/home/sven/app" },
    task: {
      uuid: "00000000-1111-2222-3333-444444444444",
      title: "Write docs",
      phase: "build",
      phase_label: "Build",
    },
    pluginDirs: [],
    allowedPhaseIds: new Set(["build", "test", "design"]),
    actionId: "new-task",
  };
}

function ctxForCustom(
  actionId: string,
  slashCommand: string | undefined,
  overrides: Partial<SubstitutionContext["task"]> = {},
): SubstitutionContext {
  return {
    ...baseCtx(),
    task: {
      ...baseCtx().task,
      phase: "content",
      phase_label: "Content",
      ...overrides,
    },
    actionId,
    slashCommand,
    allowedPhaseIds: new Set(["content"]),
  };
}

describe("actions-substitute — {task.initial_prompt} custom slash_command", () => {
  it("fuses slash + description into ONE positional for a custom actionId (POSIX)", () => {
    const ctx = ctxForCustom("orchestrate", "/content-orchestrator", {
      description: "Erstelle Artikel",
    });
    expect(substitutePlaceholders("{task.initial_prompt}", ctx, "posix")).toBe(
      "'/content-orchestrator Erstelle Artikel'",
    );
  });

  it("fuses across all three shell forms with correct quoting (AC-2/AC-4)", () => {
    const ctx = ctxForCustom("create", "/content-creator", {
      description: "Schreibe Blog",
    });
    expect(substitutePlaceholders("{task.initial_prompt}", ctx, "powershell")).toBe(
      "'/content-creator Schreibe Blog'",
    );
    expect(substitutePlaceholders("{task.initial_prompt}", ctx, "cmd")).toBe(
      `"/content-creator Schreibe Blog"`,
    );
    expect(substitutePlaceholders("{task.initial_prompt}", ctx, "posix")).toBe(
      "'/content-creator Schreibe Blog'",
    );
  });

  it("emits only the slash command (one token, no trailing space) when description is empty", () => {
    const ctx = ctxForCustom("research", "/content-research", {
      description: undefined,
    });
    expect(substitutePlaceholders("{task.initial_prompt}", ctx, "posix")).toBe(
      "'/content-research'",
    );
  });

  it("flattens a multi-line description into the single fused positional", () => {
    const ctx = ctxForCustom("orchestrate", "/content-orchestrator", {
      description: "Thema:\nAI\r\n\nBrandvoice Sven",
    });
    expect(substitutePlaceholders("{task.initial_prompt}", ctx, "posix")).toBe(
      "'/content-orchestrator Thema: AI Brandvoice Sven'",
    );
  });

  it("escapes a single-quote inside the fused token (POSIX)", () => {
    const ctx = ctxForCustom("create", "/content-creator", {
      description: "it's live",
    });
    expect(substitutePlaceholders("{task.initial_prompt}", ctx, "posix")).toBe(
      `'/content-creator it'\\''s live'`,
    );
  });

  it("BUILTIN ids ignore slash_command — new-iterate mapping wins (AC-3)", () => {
    const ctx = ctxForCustom("new-iterate", "/content-orchestrator", {
      description: "x",
    });
    expect(substitutePlaceholders("{task.initial_prompt}", ctx, "posix")).toBe(
      "'/shipwright-iterate x'",
    );
  });

  it("throws UnknownActionError for a custom id WITHOUT slash_command", () => {
    const ctx = ctxForCustom("orchestrate", undefined, { description: "x" });
    expect(() =>
      substitutePlaceholders("{task.initial_prompt}", ctx, "posix"),
    ).toThrow(UnknownActionError);
  });

  it("validateTemplate accepts a custom {task.initial_prompt} template when slash_command is supplied (AC-6)", () => {
    const result = validateTemplate(
      `{cd.prefix}claude --session-id {task.uuid} --name {task.session_name} {plugin.dirs} {task.initial_prompt}`,
      "orchestrate",
      ["content"],
      "/content-orchestrator",
    );
    expect(result).toBeNull();
  });

  it("trims stray surrounding whitespace in slash_command (review follow-up)", () => {
    // A hand-authored " /content-orchestrator " must fuse identically to the
    // un-padded form — consistent with the schema validator, which also trims.
    const ctx = ctxForCustom("orchestrate", "  /content-orchestrator  ", {
      description: "Brief",
    });
    expect(substitutePlaceholders("{task.initial_prompt}", ctx, "posix")).toBe(
      "'/content-orchestrator Brief'",
    );
  });

  it("throws UnknownActionError for a custom id with a MALFORMED slash_command", () => {
    const ctx = ctxForCustom("orchestrate", "content-orchestrator; rm -rf /", {
      description: "x",
    });
    expect(() =>
      substitutePlaceholders("{task.initial_prompt}", ctx, "posix"),
    ).toThrow(UnknownActionError);
  });
});
