import { describe, it, expect } from "vitest";

import {
  substitutePlaceholders,
  substituteAllForms,
  validateTemplate,
  InvalidPlaceholderError,
  UnknownPhaseError,
  UnsupportedShellError,
  type SubstitutionContext,
  type ShellForm,
} from "./actions-substitute.js";

function baseCtx(overrides: Partial<SubstitutionContext["task"]> = {}): SubstitutionContext {
  return {
    project: { id: "proj-123", path: "/home/sven/app" },
    task: {
      uuid: "00000000-1111-2222-3333-444444444444",
      title: "Write docs",
      phase: "build",
      phase_label: "Build",
      ...overrides,
    },
    pluginDirs: [],
    allowedPhaseIds: new Set(["build", "test", "design"]),
    actionId: "new-task",
  };
}

const SHELL_FORMS: ShellForm[] = ["powershell", "cmd", "posix"];

describe("actions-substitute — positive placeholders across shells", () => {
  // @covers FR-01.37
  it("substitutes project.path with embedded spaces (single quotes / double quotes)", () => {
    const ctx = baseCtx();
    ctx.project.path = "/home/sven/my app";
    expect(substitutePlaceholders("{project.path}", ctx, "powershell")).toBe(
      `'/home/sven/my app'`,
    );
    expect(substitutePlaceholders("{project.path}", ctx, "cmd")).toBe(
      `"/home/sven/my app"`,
    );
    expect(substitutePlaceholders("{project.path}", ctx, "posix")).toBe(
      `'/home/sven/my app'`,
    );
  });

  // @covers FR-01.37
  it("substitutes project.path containing single quotes (shell-escaped correctly)", () => {
    const ctx = baseCtx();
    ctx.project.path = "/home/sven/o'malley/app";
    // PS: ' → ''; POSIX: ' → '\''; CMD: untouched (double-quoted form)
    expect(substitutePlaceholders("{project.path}", ctx, "powershell")).toBe(
      `'/home/sven/o''malley/app'`,
    );
    expect(substitutePlaceholders("{project.path}", ctx, "posix")).toBe(
      `'/home/sven/o'\\''malley/app'`,
    );
    expect(substitutePlaceholders("{project.path}", ctx, "cmd")).toBe(
      `"/home/sven/o'malley/app"`,
    );
  });

  // @covers FR-01.37
  it("substitutes project.path containing double quotes", () => {
    const ctx = baseCtx();
    ctx.project.path = `/home/sven/He said "hi"/app`;
    // CMD: " → \"; PS/POSIX double quotes pass through single-quoted form
    expect(substitutePlaceholders("{project.path}", ctx, "cmd")).toBe(
      `"/home/sven/He said \\"hi\\"/app"`,
    );
    expect(substitutePlaceholders("{project.path}", ctx, "powershell")).toContain(
      `He said "hi"`,
    );
  });

  // @covers FR-01.37
  it("substitutes Windows trailing-backslash path", () => {
    const ctx = baseCtx();
    ctx.project.path = "C:\\dev\\app\\";
    // POSIX converts backslashes to forward slashes.
    expect(substitutePlaceholders("{project.path}", ctx, "posix")).toBe(
      "'C:/dev/app/'",
    );
    expect(substitutePlaceholders("{project.path}", ctx, "powershell")).toBe(
      "'C:\\dev\\app\\'",
    );
  });

  // @covers FR-01.37
  it("substitutes Unicode path", () => {
    const ctx = baseCtx();
    ctx.project.path = "/home/sven/äpp";
    for (const form of SHELL_FORMS) {
      const out = substitutePlaceholders("{project.path}", ctx, form);
      expect(out).toContain("äpp");
    }
  });

  // @covers FR-01.37
  it("project.id passes through UNQUOTED (server-generated UUID, safe literal)", () => {
    const ctx = baseCtx();
    for (const form of SHELL_FORMS) {
      expect(substitutePlaceholders("{project.id}", ctx, form)).toBe("proj-123");
    }
  });

  // @covers FR-01.37
  it("task.uuid passes through UNQUOTED", () => {
    const ctx = baseCtx();
    for (const form of SHELL_FORMS) {
      expect(substitutePlaceholders("{task.uuid}", ctx, form)).toBe(ctx.task.uuid);
    }
  });

  // @covers FR-01.37
  it("task.title with shell-metacharacters is escaped (not executed)", () => {
    const ctx = baseCtx({ title: "oops $(whoami) `ls` ; rm -rf /" });
    const posix = substitutePlaceholders("{task.title}", ctx, "posix");
    // POSIX single-quoted — literal content wrapped so no interpolation
    expect(posix).toBe(`'oops $(whoami) \`ls\` ; rm -rf /'`);
    expect(posix.startsWith("'")).toBe(true);
    expect(posix.endsWith("'")).toBe(true);
  });

  // @covers FR-01.37
  it("task.description? empty produces empty substitution (no leading prefix)", () => {
    const ctx = baseCtx();
    expect(substitutePlaceholders("{task.description?}", ctx, "posix")).toBe("");
    expect(substitutePlaceholders("before{task.description?}after", ctx, "posix"))
      .toBe("beforeafter");
  });

  // @covers FR-01.37
  it("task.description? non-empty produces space-prefixed escaped value", () => {
    // 2026-04-23 — post-processing in substitutePlaceholders now flattens
    // the continuation-prefix `\<newline>    ` to a single space so the
    // output is cross-shell safe (PowerShell + cmd don't honour `\`).
    const ctx = baseCtx();
    ctx.task.description = "Please fix the bug";
    const out = substitutePlaceholders("{task.description?}", ctx, "posix");
    expect(out).toBe(` 'Please fix the bug'`);
  });

  // @covers FR-01.37
  it("task.description? flattens embedded newlines to single spaces", () => {
    const ctx = baseCtx();
    // \n, \r\n and blank-line runs all collapse to one space; the launch
    // command must stay a single physical line.
    ctx.task.description = "first line\nsecond line\r\n\r\nthird";
    const out = substitutePlaceholders("{task.description?}", ctx, "posix");
    expect(out).toBe(` 'first line second line third'`);
  });

  // @covers FR-01.37
  it("task.phase validates against allowedPhaseIds", () => {
    const ctx = baseCtx();
    expect(substitutePlaceholders("{task.phase}", ctx, "posix")).toBe("build");
    ctx.task.phase = "nonexistent";
    expect(() =>
      substitutePlaceholders("{task.phase}", ctx, "posix"),
    ).toThrow(UnknownPhaseError);
  });

  // @covers FR-01.37
  it("task.phase_label is user-editable so it IS escaped", () => {
    const ctx = baseCtx({ phase_label: "my custom label with 'quotes'" });
    const posix = substitutePlaceholders("{task.phase_label}", ctx, "posix");
    expect(posix).toBe(`'my custom label with '\\''quotes'\\'''`);
  });

  // @covers FR-01.37
  it("task.autonomy_flag? renders --autonomous with prefix when autonomous", () => {
    // 2026-04-23 — post-processing flattens the continuation-prefix
    // `\<newline>    ` to a single space.
    const ctx = baseCtx();
    ctx.task.autonomy = "autonomous";
    expect(substitutePlaceholders("{task.autonomy_flag?}", ctx, "posix")).toBe(
      ` --autonomous`,
    );
  });

  // @covers FR-01.37
  it("task.autonomy_flag? empty when guided / unset", () => {
    const ctx = baseCtx();
    expect(substitutePlaceholders("{task.autonomy_flag?}", ctx, "posix")).toBe("");
    ctx.task.autonomy = "guided";
    expect(substitutePlaceholders("{task.autonomy_flag?}", ctx, "posix")).toBe("");
  });

  // @covers FR-01.37
  it("plugin.dirs empty produces empty string", () => {
    const ctx = baseCtx();
    expect(substitutePlaceholders("{plugin.dirs}", ctx, "posix")).toBe("");
  });

  // @covers FR-01.37
  it("plugin.dirs expands to space-joined --plugin-dir chunks, each escaped", () => {
    const ctx = baseCtx();
    ctx.pluginDirs = ["/home/sven/plugin a", "/home/sven/plugin b"];
    const out = substitutePlaceholders("{plugin.dirs}", ctx, "posix");
    expect(out).toBe(
      `--plugin-dir '/home/sven/plugin a' --plugin-dir '/home/sven/plugin b'`,
    );
  });
});

describe("actions-substitute — negative cases", () => {
  // @covers FR-01.37
  it("unknown placeholder throws InvalidPlaceholderError with actionId + template", () => {
    const ctx = baseCtx();
    try {
      substitutePlaceholders("hello {task.priority}", ctx, "posix");
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidPlaceholderError);
      const ipe = err as InvalidPlaceholderError;
      expect(ipe.placeholder).toBe("task.priority");
      expect(ipe.actionId).toBe("new-task");
      expect(ipe.template).toBe("hello {task.priority}");
    }
  });

  // @covers FR-01.37
  it("unsupported shell form throws UnsupportedShellError", () => {
    const ctx = baseCtx();
    expect(() =>
      substitutePlaceholders("{task.title}", ctx, "fish" as ShellForm),
    ).toThrow(UnsupportedShellError);
  });

  // @covers FR-01.37
  it("a multi-line description no longer fails a template that omits it", () => {
    // Pre-flight description-newline rejection was removed: a multi-line
    // description is flattened only by the description placeholders, and
    // a template that never references the description is unaffected.
    const ctx = baseCtx();
    ctx.task.description = "first\nsecond";
    expect(substitutePlaceholders("{task.title}", ctx, "posix")).toBe(
      `'Write docs'`,
    );
  });
});

describe("actions-substitute — substituteAllForms", () => {
  // @covers FR-01.37
  it("returns three parallel shell forms for the Shipwright new-task template", () => {
    // 2026-04-23 — `--project-root` is NOT a Claude CLI flag; replaced with
    // `--add-dir` (the standard flag for additional-directory scoping).
    const template =
      "claude /shipwright-{task.phase}{task.autonomy_flag?} \\\n    --add-dir {project.path} \\\n    --session-id {task.uuid} \\\n    --name {task.session_name} \\\n    {plugin.dirs}{task.description?}";
    const ctx = baseCtx();
    ctx.task.description = "Write docs";
    ctx.pluginDirs = ["/home/sven/plugin"];
    const out = substituteAllForms(template, ctx);
    expect(out.posix).toContain("claude /shipwright-build");
    expect(out.posix).toContain("--add-dir '/home/sven/app'");
    // {task.session_name} composes "<phase_label>: <title>" and shell-
    // escapes it ONCE — a single clean quote pair, never a literal-quote
    // wrap around an already-escaped value (iterate-2026-05-19).
    expect(out.posix).toContain(`--name 'Build: Write docs'`);
    expect(out.posix).toContain("--plugin-dir '/home/sven/plugin'");
    // 2026-04-23 — output is flattened to a single line (post-processing).
    // Description trailer is now space-separated, not on a continuation.
    expect(out.posix).toMatch(/'Write docs'$/);
    expect(out.posix.split("\n")).toHaveLength(1);
    expect(out.powershell).toContain("claude /shipwright-build");
    expect(out.cmd).toContain("claude /shipwright-build");
  });

  // @covers FR-01.37
  it("autonomous flag appears space-separated (flattened), not on a continuation line", () => {
    // 2026-04-23 — was `\<newline>    --autonomous`, now a single space
    // delimiter so PowerShell + cmd.exe parse the command correctly.
    const template =
      "claude /shipwright-run \\\n    --add-dir {project.path} \\\n    --session-id {task.uuid}{task.autonomy_flag?}";
    const ctx = baseCtx();
    ctx.task.autonomy = "autonomous";
    const out = substituteAllForms(template, ctx);
    expect(out.posix).toMatch(/--session-id 00000000-.* --autonomous$/);
    expect(out.posix.split("\n")).toHaveLength(1);
  });
});

describe("actions-substitute — validateTemplate dry-run", () => {
  // @covers FR-01.37
  it("returns null for a well-formed template", () => {
    const result = validateTemplate(
      "claude /shipwright-{task.phase} --session-id {task.uuid} --name {task.title}",
      "new-task",
      ["build", "test"],
    );
    expect(result).toBeNull();
  });

  // @covers FR-01.37
  it("returns InvalidPlaceholderError for a typo", () => {
    const result = validateTemplate(
      "claude --project {project.paht}",
      "bogus-action",
      ["build"],
    );
    expect(result).toBeInstanceOf(InvalidPlaceholderError);
    expect(result?.placeholder).toBe("project.paht");
    expect(result?.actionId).toBe("bogus-action");
  });
});

// ── 2026-04-23 — iterate-20260423-shell-line-continuations ──
//
// The bundled default-actions.json command_template ships with `\\\n    `
// POSIX-style line continuations for readability. Those MUST NOT appear in
// the final copy command — PowerShell and cmd.exe do not honour backslash
// continuation, so the user pastes the first line only and all flags
// after it are silently dropped. (ADR-046 regression from iterate
// 20260423-launch-command-wiring.) The renderer now collapses any
// `<space> \\\n<spaces>` sequence into a single space before returning.
describe("actions-substitute — single-line output (2026-04-23)", () => {
  const MULTILINE = `claude /shipwright-{task.phase}{task.autonomy_flag?} \\
    --add-dir {project.path} \\
    --session-id {task.uuid} \\
    --name "{task.phase_label}: {task.title}" \\
    {plugin.dirs}{task.description?}`;

  function assertSingleLine(output: string): void {
    expect(output).not.toContain("\\\n");
    expect(output).not.toContain("\\ \n");
    expect(output.split("\n")).toHaveLength(1);
  }

  // @covers FR-01.37
  it("flattens multi-line template to one line in powershell", () => {
    const ctx = baseCtx({ description: "fix login" });
    const out = substitutePlaceholders(MULTILINE, ctx, "powershell");
    assertSingleLine(out);
    // All key tokens must still be present.
    expect(out).toContain("/shipwright-build");
    expect(out).toContain("--add-dir");
    expect(out).toContain("--session-id");
    expect(out).toContain("--name");
    expect(out).toContain("fix login");
  });

  // @covers FR-01.37
  it("flattens multi-line template to one line in cmd", () => {
    const ctx = baseCtx({ description: "fix login" });
    const out = substitutePlaceholders(MULTILINE, ctx, "cmd");
    assertSingleLine(out);
    expect(out).toContain("/shipwright-build");
  });

  // @covers FR-01.37
  it("flattens multi-line template to one line in posix", () => {
    const ctx = baseCtx({ description: "fix login" });
    const out = substitutePlaceholders(MULTILINE, ctx, "posix");
    assertSingleLine(out);
    expect(out).toContain("/shipwright-build");
  });

  // @covers FR-01.37
  it("collapses the empty-plugin-dirs gap without leaving a dangling continuation", () => {
    // `{plugin.dirs}` expands to "" when pluginDirs is empty. Without
    // flattening, the prior ` \\\n    ` from the preceding `--name` line
    // leaked a `\\ \\\n    ` artefact into the output.
    const ctx = baseCtx({ description: "desc" });
    for (const shell of SHELL_FORMS) {
      const out = substitutePlaceholders(MULTILINE, ctx, shell);
      expect(out).not.toMatch(/\\\s*\\/); // no double-backslash artifacts
      expect(out).not.toContain("  \\"); // no orphan continuation-backslash
    }
  });

  // @covers FR-01.37
  it("collapses when description is absent (optional suffix empty)", () => {
    const ctx = baseCtx(); // no description
    for (const shell of SHELL_FORMS) {
      const out = substitutePlaceholders(MULTILINE, ctx, shell);
      expect(out).not.toContain("\\\n");
      expect(out.split("\n")).toHaveLength(1);
    }
  });
});

// ── 2026-04-23 — iterate-20260423-launch-cwd-prefix ──
//
// `--add-dir` only grants Claude tool-access to the project root; it does
// NOT change the shell's working directory. When the user pastes the copy
// command in a terminal that happens to be parked in $HOME, the skill
// runs with `pwd === $HOME`, fails to find `shipwright_run_config.json`,
// and exits immediately. The fix: a new `{cd.prefix}` placeholder that
// expands to a shell-specific `cd` command + separator, so the slash
// command runs with the project as cwd regardless of where the terminal
// happened to be.
describe("actions-substitute — {cd.prefix} placeholder (2026-04-23)", () => {
  // @covers FR-01.37
  it("expands to PowerShell Set-Location with single-quote escaping + -ErrorAction Stop", () => {
    // -ErrorAction Stop upgrades Set-Location's non-terminating error to
    // terminating so a wrong path surfaces as a clean cd failure rather
    // than a confusing missing-config error from the skill.
    const ctx = baseCtx();
    ctx.project.path = "/home/sven/my app";
    const out = substitutePlaceholders("{cd.prefix}claude --version", ctx, "powershell");
    expect(out).toBe(
      `Set-Location '/home/sven/my app' -ErrorAction Stop; claude --version`,
    );
  });

  // @covers FR-01.37
  it("expands to cmd.exe `cd /d` with double-quote escaping", () => {
    const ctx = baseCtx();
    ctx.project.path = "/home/sven/my app";
    const out = substitutePlaceholders("{cd.prefix}claude --version", ctx, "cmd");
    expect(out).toBe(`cd /d "/home/sven/my app" && claude --version`);
  });

  // @covers FR-01.37
  it("expands to POSIX `cd && ` with single-quote escaping", () => {
    const ctx = baseCtx();
    ctx.project.path = "/home/sven/my app";
    const out = substitutePlaceholders("{cd.prefix}claude --version", ctx, "posix");
    expect(out).toBe(`cd '/home/sven/my app' && claude --version`);
  });

  // @covers FR-01.37
  it("converts Windows backslashes to forward slashes for POSIX form (matches {project.path})", () => {
    const ctx = baseCtx();
    ctx.project.path = "C:\\dev\\app";
    const out = substitutePlaceholders("{cd.prefix}claude", ctx, "posix");
    expect(out).toBe(`cd 'C:/dev/app' && claude`);
  });

  // @covers FR-01.37
  it("preserves Windows backslashes for PowerShell + cmd forms", () => {
    const ctx = baseCtx();
    ctx.project.path = "C:\\dev\\app";
    expect(substitutePlaceholders("{cd.prefix}claude", ctx, "powershell")).toBe(
      `Set-Location 'C:\\dev\\app' -ErrorAction Stop; claude`,
    );
    expect(substitutePlaceholders("{cd.prefix}claude", ctx, "cmd")).toBe(
      `cd /d "C:\\dev\\app" && claude`,
    );
  });

  // @covers FR-01.37
  it("escapes embedded single quotes (PowerShell + POSIX) and double quotes (cmd) in path", () => {
    const ctx = baseCtx();
    ctx.project.path = "/home/sven/o'malley/app";
    expect(substitutePlaceholders("{cd.prefix}claude", ctx, "powershell")).toBe(
      `Set-Location '/home/sven/o''malley/app' -ErrorAction Stop; claude`,
    );
    expect(substitutePlaceholders("{cd.prefix}claude", ctx, "posix")).toBe(
      `cd '/home/sven/o'\\''malley/app' && claude`,
    );
  });

  // @covers FR-01.37
  it("expands to empty string when project.path is empty (graceful fallback)", () => {
    const ctx = baseCtx();
    ctx.project.path = "";
    for (const shell of SHELL_FORMS) {
      const out = substitutePlaceholders("{cd.prefix}claude --version", ctx, shell);
      expect(out).toBe("claude --version");
    }
  });

  // @covers FR-01.37
  it("survives line-continuation flattening (cd prefix is one logical token)", () => {
    // The post-processing flattener collapses ` \\\n    ` to a single
    // space. The cd prefix must not be split or dangling-backslashed by
    // that pass.
    const ctx = baseCtx();
    ctx.project.path = "/home/sven/app";
    const template =
      "{cd.prefix}claude /shipwright-{task.phase} \\\n    --add-dir {project.path}";
    const out = substitutePlaceholders(template, ctx, "posix");
    expect(out).toBe(
      `cd '/home/sven/app' && claude /shipwright-build --add-dir '/home/sven/app'`,
    );
  });

  // @covers FR-01.37
  it("appears at the start of the output (precedes the slash command in real templates)", () => {
    // Live shape from default-actions.json after the fix is applied.
    const ctx = baseCtx();
    const template = `{cd.prefix}claude /shipwright-{task.phase} --add-dir {project.path}`;
    for (const shell of SHELL_FORMS) {
      const out = substitutePlaceholders(template, ctx, shell);
      // First non-whitespace token must be the cd-style command, not `claude`.
      expect(out.startsWith("claude")).toBe(false);
      expect(out).toContain("claude /shipwright-build");
    }
  });

  // @covers FR-01.37
  it("is rejected when used outside the allowlist as `cd.foo`", () => {
    const ctx = baseCtx();
    expect(() =>
      substitutePlaceholders("{cd.foo}claude", ctx, "posix"),
    ).toThrow(InvalidPlaceholderError);
  });

  // @covers FR-01.37
  it("validateTemplate accepts a template containing {cd.prefix}", () => {
    const result = validateTemplate(
      "{cd.prefix}claude /shipwright-{task.phase} --add-dir {project.path}",
      "new-task",
      ["build"],
    );
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// {task.parameters?} substitution — iterate/launch-cli-parameters § 2 + Tests #1-#7
// ---------------------------------------------------------------------------

import { InvalidParameterError } from "./actions-substitute.js";
import type { ResolvedParam } from "../types/action-schema.js";

function ctxWithParams(parameters: ResolvedParam[]): SubstitutionContext {
  return { ...baseCtx(), task: { ...baseCtx().task, parameters } };
}

describe("actions-substitute — {task.parameters?} substitution", () => {
  // @covers FR-01.37
  it("renders empty string when parameters is undefined or empty (#1)", () => {
    const ctx = baseCtx();
    for (const shell of SHELL_FORMS) {
      expect(substitutePlaceholders("X{task.parameters?}Y", ctx, shell)).toBe("XY");
    }
    const ctx2 = ctxWithParams([]);
    for (const shell of SHELL_FORMS) {
      expect(substitutePlaceholders("X{task.parameters?}Y", ctx2, shell)).toBe("XY");
    }
  });

  // @covers FR-01.37
  it("renders a single boolean flag with leading space (#1)", () => {
    const ctx = ctxWithParams([
      { cli_flag: "--dry-run", separator: "none" },
    ]);
    for (const shell of SHELL_FORMS) {
      expect(substitutePlaceholders("X{task.parameters?}", ctx, shell)).toBe(
        "X --dry-run",
      );
    }
  });

  // @covers FR-01.37
  it("renders multiple flags joined by single spaces (#1)", () => {
    const ctx = ctxWithParams([
      { cli_flag: "--dry-run", separator: "none" },
      { cli_flag: "--scope", value: "library", separator: "space" },
      { cli_flag: "--fix", separator: "none" },
    ]);
    // qPs always wraps in single quotes; that's the documented contract.
    expect(substitutePlaceholders("X{task.parameters?}", ctx, "powershell")).toBe(
      "X --dry-run --scope 'library' --fix",
    );
  });

  // @covers FR-01.37
  it("escapes string values with shell-specific quoting (#2)", () => {
    const ctx = ctxWithParams([
      { cli_flag: "--note", value: 'has "quote" and space', separator: "space" },
    ]);
    // PowerShell uses single quotes; embedded double quotes pass through.
    expect(substitutePlaceholders("{task.parameters?}", ctx, "powershell")).toBe(
      ` --note 'has "quote" and space'`,
    );
    // CMD wraps in double quotes; embedded double quotes are escaped as \".
    expect(substitutePlaceholders("{task.parameters?}", ctx, "cmd")).toBe(
      ` --note "has \\"quote\\" and space"`,
    );
    // POSIX single-quotes, embedded single quotes use the standard ' close ' \\' ' open trick.
    expect(substitutePlaceholders("{task.parameters?}", ctx, "posix")).toBe(
      ` --note 'has "quote" and space'`,
    );
  });

  // @covers FR-01.37
  it("escapes single quotes in string values (#2)", () => {
    const ctx = ctxWithParams([
      { cli_flag: "--note", value: "it's me", separator: "space" },
    ]);
    expect(substitutePlaceholders("{task.parameters?}", ctx, "posix")).toBe(
      ` --note 'it'\\''s me'`,
    );
    expect(substitutePlaceholders("{task.parameters?}", ctx, "powershell")).toBe(
      ` --note 'it''s me'`,
    );
  });

  // @covers FR-01.37
  it("rejects a parameter value containing a newline (#3)", () => {
    const ctx = ctxWithParams([
      { cli_flag: "--note", value: "line1\nline2", separator: "space" },
    ]);
    expect(() =>
      substitutePlaceholders("{task.parameters?}", ctx, "posix"),
    ).toThrow(InvalidParameterError);
  });

  // @covers FR-01.37
  it("rejects a parameter value containing a carriage return (#3)", () => {
    const ctx = ctxWithParams([
      { cli_flag: "--note", value: "line1\rline2", separator: "space" },
    ]);
    expect(() =>
      substitutePlaceholders("{task.parameters?}", ctx, "cmd"),
    ).toThrow(InvalidParameterError);
  });

  // @covers FR-01.37
  it("equals separator escapes only the value, not the flag=value composite (#4)", () => {
    const ctx = ctxWithParams([
      { cli_flag: "--key", value: "the value", separator: "equals" },
    ]);
    // Format must be `--key='the value'`, NOT `'--key=the value'`.
    expect(substitutePlaceholders("{task.parameters?}", ctx, "powershell")).toBe(
      ` --key='the value'`,
    );
    expect(substitutePlaceholders("{task.parameters?}", ctx, "cmd")).toBe(
      ` --key="the value"`,
    );
    expect(substitutePlaceholders("{task.parameters?}", ctx, "posix")).toBe(
      ` --key='the value'`,
    );
  });

  // @covers FR-01.37
  it("none separator emits cli_flag<value> with no space — `@<file>` form (#5)", () => {
    const ctx = ctxWithParams([
      { cli_flag: "@", value: "planning/03-section.md", separator: "none" },
    ]);
    expect(substitutePlaceholders("{task.parameters?}", ctx, "powershell")).toBe(
      ` @'planning/03-section.md'`,
    );
    expect(substitutePlaceholders("{task.parameters?}", ctx, "cmd")).toBe(
      ` @"planning/03-section.md"`,
    );
    expect(substitutePlaceholders("{task.parameters?}", ctx, "posix")).toBe(
      ` @'planning/03-section.md'`,
    );
  });

  // @covers FR-01.37
  it("preserves schema order: [section, from] renders @file before --from (#7)", () => {
    const ctx = ctxWithParams([
      { cli_flag: "@", value: "planning/03.md", separator: "none" },
      { cli_flag: "--from", value: "03", separator: "space" },
    ]);
    expect(substitutePlaceholders("{task.parameters?}", ctx, "posix")).toBe(
      ` @'planning/03.md' --from '03'`,
    );
  });

  // @covers FR-01.37
  it("adjacency: {plugin.dirs}{task.parameters?}{task.description?} all populated (#6)", () => {
    const ctx: SubstitutionContext = {
      ...baseCtx({
        description: "do the thing",
        parameters: [
          { cli_flag: "--dry-run", separator: "none" },
        ],
      }),
      pluginDirs: ["/plugins/foo"],
    };
    const out = substitutePlaceholders(
      "claude{plugin.dirs}{task.parameters?}{task.description?}",
      ctx,
      "posix",
    );
    // Expect: claude --plugin-dir '/plugins/foo' --dry-run 'do the thing'
    // No double spaces, no dangling separators.
    expect(out).not.toMatch(/  /);
    expect(out).not.toMatch(/\\\n/); // no leftover line continuations
    expect(out).toContain(`--plugin-dir '/plugins/foo'`);
    expect(out).toContain("--dry-run");
    expect(out).toContain(`'do the thing'`);
  });

  // @covers FR-01.37
  it("adjacency: all three optional suffixes empty produces no extra spaces (#6)", () => {
    const ctx = baseCtx(); // no parameters, no description
    const out = substitutePlaceholders(
      "claude{plugin.dirs}{task.parameters?}{task.description?}",
      ctx,
      "posix",
    );
    expect(out).toBe("claude");
  });
});

describe("actions-substitute — validateTemplate dry-run with parameters", () => {
  // @covers FR-01.37
  it("accepts a template containing {task.parameters?} (synthetic dry-run)", () => {
    const result = validateTemplate(
      "claude /shipwright-{task.phase} {task.parameters?}",
      "new-task",
      ["build"],
    );
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// {task.initial_prompt} — iterate/fix-adopt-prompt-shape § 1
// ---------------------------------------------------------------------------

import { UnknownActionError } from "./actions-substitute.js";

function ctxFor(actionId: string, overrides: Partial<SubstitutionContext["task"]> = {}): SubstitutionContext {
  return {
    ...baseCtx(),
    task: { ...baseCtx().task, ...overrides },
    actionId,
    // initial_prompt branch validates phase against allowedPhaseIds for new-task.
    // iterate-2026-05-21-triage-fix-now-and-phase-slash — added "plan" + "security"
    // so the namespaced-phase regression guards (AC-1, AC-3) can pass.
    allowedPhaseIds: new Set([
      "build",
      "test",
      "design",
      "plan",
      "security",
      "adopt",
      "deploy",
      "changelog",
      "compliance",
    ]),
  };
}

describe("actions-substitute — {task.initial_prompt} basic shape", () => {
  // @covers FR-01.37
  it("renders /shipwright-{phase} for new-task wrapped in shell quotes (POSIX)", () => {
    const ctx = ctxFor("new-task", { phase: "build" });
    expect(substitutePlaceholders("{task.initial_prompt}", ctx, "posix")).toBe(
      "'/shipwright-build'",
    );
  });

  // @covers FR-01.37
  it("renders /shipwright-iterate for new-iterate (POSIX)", () => {
    const ctx = ctxFor("new-iterate");
    expect(substitutePlaceholders("{task.initial_prompt}", ctx, "posix")).toBe(
      "'/shipwright-iterate'",
    );
  });

  // @covers FR-01.37
  it("renders /shipwright-run:run for new-pipeline (POSIX)", () => {
    // iterate-2026-05-21-triage-fix-now-and-phase-slash AC-4 — new-pipeline
    // emits the namespaced `:run` form so Claude Code skill resolution lands
    // on the right skill. The bare `/shipwright-run` form failed empirically.
    const ctx = ctxFor("new-pipeline");
    expect(substitutePlaceholders("{task.initial_prompt}", ctx, "posix")).toBe(
      "'/shipwright-run:run'",
    );
  });

  // @covers FR-01.37
  it("renders /shipwright-plan:plan for new-task + phase=plan (AC-1, all shell forms)", () => {
    // iterate-2026-05-21-triage-fix-now-and-phase-slash AC-1.
    const ctx = ctxFor("new-task", { phase: "plan" });
    expect(substitutePlaceholders("{task.initial_prompt}", ctx, "posix")).toBe(
      "'/shipwright-plan:plan'",
    );
    expect(substitutePlaceholders("{task.initial_prompt}", ctx, "powershell")).toBe(
      "'/shipwright-plan:plan'",
    );
    expect(substitutePlaceholders("{task.initial_prompt}", ctx, "cmd")).toBe(
      `"/shipwright-plan:plan"`,
    );
  });

  // @covers FR-01.37
  it("renders /shipwright-test:test for new-task + phase=test (AC-2)", () => {
    // iterate-2026-05-21-triage-fix-now-and-phase-slash AC-2.
    const ctx = ctxFor("new-task", { phase: "test" });
    expect(substitutePlaceholders("{task.initial_prompt}", ctx, "posix")).toBe(
      "'/shipwright-test:test'",
    );
  });

  // @covers FR-01.37
  it("renders /shipwright-security:security for new-task + phase=security (AC-3, all shell forms)", () => {
    // iterate-2026-05-21-triage-fix-now-and-phase-slash AC-3.
    const ctx = ctxFor("new-task", { phase: "security" });
    expect(substitutePlaceholders("{task.initial_prompt}", ctx, "posix")).toBe(
      "'/shipwright-security:security'",
    );
    expect(substitutePlaceholders("{task.initial_prompt}", ctx, "powershell")).toBe(
      "'/shipwright-security:security'",
    );
    expect(substitutePlaceholders("{task.initial_prompt}", ctx, "cmd")).toBe(
      `"/shipwright-security:security"`,
    );
  });

  // @covers FR-01.37
  it("renders /shipwright-build (bare) for new-task + phase=build — regression guard (AC-5)", () => {
    // iterate-2026-05-21-triage-fix-now-and-phase-slash AC-5: phases NOT
    // flagged by the user as broken (build / design / deploy / changelog /
    // compliance / adopt) keep the bare form. Workaround scope is the four
    // empirically-broken cases.
    const ctx = ctxFor("new-task", { phase: "build" });
    expect(substitutePlaceholders("{task.initial_prompt}", ctx, "posix")).toBe(
      "'/shipwright-build'",
    );
  });

  // @covers FR-01.37
  it("renders /shipwright-iterate (bare) for new-iterate — regression guard (AC-6)", () => {
    // iterate-2026-05-21-triage-fix-now-and-phase-slash AC-6: iterate skill
    // resolves correctly bare; user did NOT flag it.
    const ctx = ctxFor("new-iterate");
    expect(substitutePlaceholders("{task.initial_prompt}", ctx, "posix")).toBe(
      "'/shipwright-iterate'",
    );
  });

  // @covers FR-01.37
  it("throws UnknownActionError for unknown actionId", () => {
    const ctx = ctxFor("custom-action");
    expect(() =>
      substitutePlaceholders("{task.initial_prompt}", ctx, "posix"),
    ).toThrow(UnknownActionError);
  });

  // @covers FR-01.37
  it("uses correct shell quote per form", () => {
    const ctx = ctxFor("new-iterate");
    expect(substitutePlaceholders("{task.initial_prompt}", ctx, "powershell")).toBe(
      "'/shipwright-iterate'",
    );
    expect(substitutePlaceholders("{task.initial_prompt}", ctx, "cmd")).toBe(
      `"/shipwright-iterate"`,
    );
    expect(substitutePlaceholders("{task.initial_prompt}", ctx, "posix")).toBe(
      "'/shipwright-iterate'",
    );
  });
});

describe("actions-substitute — {task.initial_prompt} composition", () => {
  // @covers FR-01.37
  it("appends --autonomous when autonomy=autonomous", () => {
    // iterate-2026-05-21 — slash now emits the namespaced `:run` form.
    const ctx = ctxFor("new-pipeline", { autonomy: "autonomous" });
    expect(substitutePlaceholders("{task.initial_prompt}", ctx, "posix")).toBe(
      "'/shipwright-run:run --autonomous'",
    );
  });

  // @covers FR-01.37
  it("omits --autonomous when autonomy=guided or undefined", () => {
    // iterate-2026-05-21 — slash now emits the namespaced `:run` form.
    const ctxGuided = ctxFor("new-pipeline", { autonomy: "guided" });
    expect(substitutePlaceholders("{task.initial_prompt}", ctxGuided, "posix")).toBe(
      "'/shipwright-run:run'",
    );
  });

  // @covers FR-01.37
  it("appends parameters in declared order", () => {
    const ctx = ctxFor("new-task", {
      phase: "adopt",
      parameters: [
        { cli_flag: "--dry-run", separator: "none" },
        { cli_flag: "--scope", value: "full_app", separator: "space" },
      ],
    });
    expect(substitutePlaceholders("{task.initial_prompt}", ctx, "posix")).toBe(
      "'/shipwright-adopt --dry-run --scope full_app'",
    );
  });

  // @covers FR-01.37
  it("appends description as raw trailing text", () => {
    // iterate-2026-05-21 — phase=test now emits the namespaced `:test` form.
    const ctx = ctxFor("new-task", {
      phase: "test",
      description: "run vitest suite",
    });
    expect(substitutePlaceholders("{task.initial_prompt}", ctx, "posix")).toBe(
      "'/shipwright-test:test run vitest suite'",
    );
  });

  // @covers FR-01.37
  it("composes slash + autonomy + params + description in that order", () => {
    const ctx = ctxFor("new-iterate", {
      autonomy: "autonomous",
      parameters: [
        { cli_flag: "--type", value: "bug", separator: "space" },
      ],
      description: "fix-the-thing",
    });
    expect(substitutePlaceholders("{task.initial_prompt}", ctx, "posix")).toBe(
      "'/shipwright-iterate --autonomous --type bug fix-the-thing'",
    );
  });

  // @covers FR-01.37
  it("matches the user-provided adopt schema", () => {
    const ctx = ctxFor("new-task", {
      phase: "adopt",
      parameters: [
        { cli_flag: "--dry-run", separator: "none" },
        { cli_flag: "--scope", value: "full_app", separator: "space" },
        { cli_flag: "--planning-split", value: "01-command-center", separator: "space" },
      ],
    });
    expect(substitutePlaceholders("{task.initial_prompt}", ctx, "posix")).toBe(
      "'/shipwright-adopt --dry-run --scope full_app --planning-split 01-command-center'",
    );
  });
});

describe("actions-substitute — {task.initial_prompt} cross-shell special chars", () => {
  // @covers FR-01.37
  it("POSIX: $, `, \\\\, !, ^, &, |, <, >, (, ) in description are inhibited by single-quote wrap", () => {
    const ctx = ctxFor("new-task", {
      phase: "build",
      description: "$VAR `cmd` \\path !x ^a &b |c <d >e (f) g",
    });
    const out = substitutePlaceholders("{task.initial_prompt}", ctx, "posix");
    // Whole content wrapped in single-quotes — no shell expansion possible.
    expect(out.startsWith("'/shipwright-build")).toBe(true);
    expect(out.endsWith("'")).toBe(true);
    expect(out).toContain("$VAR");
    expect(out).toContain("`cmd`");
  });

  // @covers FR-01.37
  it("POSIX: single quote in description gets standard '\\'' escape", () => {
    const ctx = ctxFor("new-task", {
      phase: "build",
      description: "it's done",
    });
    expect(substitutePlaceholders("{task.initial_prompt}", ctx, "posix")).toBe(
      `'/shipwright-build it'\\''s done'`,
    );
  });

  // @covers FR-01.37
  it("PowerShell: single quote in description gets PS doubling escape", () => {
    const ctx = ctxFor("new-task", {
      phase: "build",
      description: "it's done",
    });
    expect(substitutePlaceholders("{task.initial_prompt}", ctx, "powershell")).toBe(
      `'/shipwright-build it''s done'`,
    );
  });

  // @covers FR-01.37
  it("cmd: double quote in description gets backslash escape", () => {
    const ctx = ctxFor("new-task", {
      phase: "build",
      description: 'say "hi"',
    });
    expect(substitutePlaceholders("{task.initial_prompt}", ctx, "cmd")).toBe(
      `"/shipwright-build say \\"hi\\""`,
    );
  });

  // @covers FR-01.37
  it("POSIX: special chars in param value are inside the outer single-quote", () => {
    const ctx = ctxFor("new-task", {
      phase: "adopt",
      parameters: [
        { cli_flag: "--note", value: "$HOME and `pwd`", separator: "space" },
      ],
    });
    const out = substitutePlaceholders("{task.initial_prompt}", ctx, "posix");
    expect(out).toBe("'/shipwright-adopt --note $HOME and `pwd`'");
  });

  // @covers FR-01.37
  it("flattens newlines (LF, CRLF, blank-line runs) in the initial prompt", () => {
    // {task.initial_prompt} is the branch the triage→launch chain hits
    // (new-iterate/new-task templates). The whole prompt is one
    // shell-quoted token; a multi-line brief must collapse to one
    // physical line so the launch command stays single-line.
    const ctx = ctxFor("new-task", {
      phase: "build",
      description: "line1\nline2\r\nline3\n\nline4",
    });
    expect(
      substitutePlaceholders("{task.initial_prompt}", ctx, "posix"),
    ).toBe("'/shipwright-build line1 line2 line3 line4'");
  });

  // @covers FR-01.37
  it("rejects newline in any param value", () => {
    const ctx = ctxFor("new-task", {
      phase: "adopt",
      parameters: [{ cli_flag: "--note", value: "a\nb", separator: "space" }],
    });
    expect(() =>
      substitutePlaceholders("{task.initial_prompt}", ctx, "posix"),
    ).toThrow(InvalidParameterError);
  });
});

describe("actions-substitute — {task.initial_prompt} integration with full template", () => {
  // @covers FR-01.37
  it("renders the full bundled new-task command shape", () => {
    const ctx = ctxFor("new-task", {
      phase: "adopt",
      phase_label: "Adopt",
      title: "audit drift",
      parameters: [
        { cli_flag: "--dry-run", separator: "none" },
        { cli_flag: "--scope", value: "full_app", separator: "space" },
      ],
    });
    ctx.project.path = "/home/sven/app";
    // Mirrors the bundled new-task command_template verbatim
    // (default-actions.json) — iterate-2026-05-19 replaced the literal-
    // quote-wrapped --name with the bare {task.session_name} placeholder.
    const template =
      `{cd.prefix}claude --session-id {task.uuid} --name {task.session_name} {plugin.dirs} {task.initial_prompt}`;
    const out = substitutePlaceholders(template, ctx, "posix");
    // The prompt is the LAST argument, single-quoted; --add-dir is gone.
    expect(out).toContain("cd '/home/sven/app' && claude");
    expect(out).toContain("--session-id");
    // --name is a single cleanly-quoted token "<phase_label>: <title>" —
    // no literal-quote wrap, no nested quotes.
    expect(out).toContain("--name 'Adopt: audit drift'");
    expect(out).not.toContain(`"`);
    expect(out).not.toContain("--add-dir");
    expect(out).not.toContain(" /shipwright-adopt "); // no slash command directly after `claude`
    expect(out).toMatch(/'\/shipwright-adopt --dry-run --scope full_app'$/);
  });
});

describe("validateTemplate with {task.initial_prompt}", () => {
  // @covers FR-01.37
  it("accepts a template using the new placeholder", () => {
    const result = validateTemplate(
      `{cd.prefix}claude --session-id {task.uuid} --name "{task.phase_label}: {task.title}" {plugin.dirs} {task.initial_prompt}`,
      "new-task",
      ["build"],
    );
    expect(result).toBeNull();
  });
});
