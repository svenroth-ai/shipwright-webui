import { describe, it, expect, afterEach } from "vitest";

import { buildCodexCommands, buildCodexPrompt } from "./launcher-codex.js";

const CWD = String.raw`C:\Users\you\projects\shipwright`;
const THREAD_ID = "thread-abc-123";

describe("launcher-codex.buildCodexCommands", () => {
  // @covers FR-01.74
  it("emits three shell forms with the codex binary and a cd prefix", () => {
    const c = buildCodexCommands({ cwd: CWD, phase: "iterate" });
    expect(c.powershell).toContain("& codex ");
    expect(c.cmd).toContain("codex ");
    expect(c.posix).toContain("codex ");
    expect(c.powershell).toMatch(/^Set-Location/);
    expect(c.cmd).toMatch(/^cd \/d/);
    expect(c.posix).toMatch(/^cd /);
  });

  it("guided (default) — enables default_mode_request_user_input, on-request approvals", () => {
    const c = buildCodexCommands({ cwd: CWD, autonomy: "guided" });
    expect(c.posix).toContain("--enable default_mode_request_user_input");
    expect(c.posix).toContain("approval_policy=on-request");
    expect(c.posix).toContain("approvals.reviewer=user");
    expect(c.posix).not.toContain("--yolo");
  });

  it("autonomous — --yolo, no default_mode_request_user_input", () => {
    const c = buildCodexCommands({ cwd: CWD, autonomy: "autonomous" });
    expect(c.posix).toContain("--yolo");
    expect(c.posix).not.toContain("default_mode_request_user_input");
    expect(c.posix).not.toContain("approval_policy=on-request");
  });

  it("always threads shell_environment_policy.inherit=all (§2.4)", () => {
    const c = buildCodexCommands({ cwd: CWD, autonomy: "autonomous" });
    expect(c.posix).toContain("shell_environment_policy.inherit=all");
  });

  // iterate-2026-09-19-codex-terminal-flicker (CLAUDE.md DO-NOT #32) —
  // `tui.animations=false` suppresses Codex's own recurring TUI redraw
  // chatter (title spinner + status-widget redraws) during a turn.
  describe("tui.animations=false (terminal-flicker mitigation)", () => {
    const ORIGINAL = process.env.SHIPWRIGHT_CODEX_TUI_ANIMATIONS;
    afterEach(() => {
      if (ORIGINAL === undefined) delete process.env.SHIPWRIGHT_CODEX_TUI_ANIMATIONS;
      else process.env.SHIPWRIGHT_CODEX_TUI_ANIMATIONS = ORIGINAL;
    });

    it("is threaded by default on a fresh launch", () => {
      const c = buildCodexCommands({ cwd: CWD });
      expect(c.posix).toContain("tui.animations=false");
    });

    it("is threaded by default on resume", () => {
      const c = buildCodexCommands({ cwd: CWD, resume: true, threadId: THREAD_ID });
      expect(c.posix).toContain("tui.animations=false");
    });

    it("is omitted when SHIPWRIGHT_CODEX_TUI_ANIMATIONS=0 (fresh launch)", () => {
      process.env.SHIPWRIGHT_CODEX_TUI_ANIMATIONS = "0";
      const c = buildCodexCommands({ cwd: CWD });
      expect(c.posix).not.toContain("tui.animations=false");
    });

    it("is omitted when SHIPWRIGHT_CODEX_TUI_ANIMATIONS=0 (resume)", () => {
      process.env.SHIPWRIGHT_CODEX_TUI_ANIMATIONS = "0";
      const c = buildCodexCommands({ cwd: CWD, resume: true, threadId: THREAD_ID });
      expect(c.posix).not.toContain("tui.animations=false");
    });

    it("any other value keeps the flag on (only the literal '0' opts out)", () => {
      process.env.SHIPWRIGHT_CODEX_TUI_ANIMATIONS = "false";
      const c = buildCodexCommands({ cwd: CWD });
      expect(c.posix).toContain("tui.animations=false");
    });
  });

  // External-code-review finding (GLM MEDIUM, 2026-09-16): `codex resume
  // --help` accepts the same autonomy/env-inherit flags as a fresh launch
  // (verified live) — resume must carry them too, or a resumed session
  // silently loses both session-identity tracking and autonomy governance.
  it("resume=true, guided (default) — still threads env-inherit + on-request approvals", () => {
    const c = buildCodexCommands({ cwd: CWD, resume: true, threadId: THREAD_ID });
    expect(c.posix).toContain("codex resume");
    expect(c.posix).toContain(`'${THREAD_ID}'`);
    expect(c.posix).toContain("shell_environment_policy.inherit=all");
    expect(c.posix).toContain("--enable default_mode_request_user_input");
    expect(c.posix).toContain("approval_policy=on-request");
    expect(c.posix).not.toContain("--yolo");
  });

  it("resume=true, autonomous — --yolo, still threads env-inherit, no user-input flag", () => {
    const c = buildCodexCommands({ cwd: CWD, resume: true, threadId: THREAD_ID, autonomy: "autonomous" });
    expect(c.posix).toContain("codex resume");
    expect(c.posix).toContain(`'${THREAD_ID}'`);
    expect(c.posix).toContain("shell_environment_policy.inherit=all");
    expect(c.posix).toContain("--yolo");
    expect(c.posix).not.toContain("default_mode_request_user_input");
  });

  it("resume=true without a threadId throws", () => {
    expect(() => buildCodexCommands({ cwd: CWD, resume: true })).toThrow(/threadId/);
  });

  it("converts path separators to forward slashes for the POSIX cd prefix", () => {
    const c = buildCodexCommands({ cwd: CWD });
    expect(c.posix).toContain("cd 'C:/Users/you/projects/shipwright'");
  });

  // iterate-2026-09-17-codex-model-tier-parameterization — implementation-model
  // override, fresh launch. A real `-c model=` CLI flag (not prose), so it
  // applies before Codex ever reads AGENTS.md — unconditional on hasAgentsMd.
  it("implementationModel set, fresh launch — emits -c model=\"<slug>\"", () => {
    const c = buildCodexCommands({ cwd: CWD, implementationModel: "gpt-5.6-luna" });
    expect(c.posix).toContain(`-c 'model="gpt-5.6-luna"'`);
  });

  it("implementationModel unset, fresh launch — emits no -c model= flag", () => {
    const c = buildCodexCommands({ cwd: CWD });
    expect(c.posix).not.toContain("model=");
  });

  it("implementationModel set, resume — emits -c model=\"<slug>\" on the resume command too", () => {
    const c = buildCodexCommands({
      cwd: CWD,
      resume: true,
      threadId: THREAD_ID,
      implementationModel: "gpt-5.6-sol",
    });
    expect(c.posix).toContain("codex resume");
    expect(c.posix).toContain(`-c 'model="gpt-5.6-sol"'`);
  });

  it("implementationModel unset, resume — emits no -c model= flag", () => {
    const c = buildCodexCommands({ cwd: CWD, resume: true, threadId: THREAD_ID });
    expect(c.posix).not.toContain("model=");
  });

  it("implementationModel value is shell-quoted per shell form (cmd, powershell)", () => {
    const c = buildCodexCommands({ cwd: CWD, implementationModel: "gpt-5.6-terra" });
    expect(c.cmd).toContain(`-c "model=\\"gpt-5.6-terra\\""`);
    expect(c.powershell).toContain(`-c 'model="gpt-5.6-terra"'`);
  });

  // iterate-2026-09-19-codex-reviewer-fields — review-model overrides are an
  // env-var prefix ahead of `codex`, not a `-c` flag (see planReviewModel/
  // reviewModel's doc comment on CodexLaunchArgs for why).
  it("planReviewModel + reviewModel set — emits both as an env-var prefix, posix", () => {
    const c = buildCodexCommands({
      cwd: CWD,
      planReviewModel: "gpt-5.6-terra",
      reviewModel: "gpt-5.6-sol",
    });
    expect(c.posix).toContain("SHIPWRIGHT_CODEX_PLAN_REVIEW_MODEL='gpt-5.6-terra'");
    expect(c.posix).toContain("SHIPWRIGHT_CODEX_REVIEW_MODEL='gpt-5.6-sol'");
    expect(c.posix.indexOf("SHIPWRIGHT_CODEX_PLAN_REVIEW_MODEL")).toBeLessThan(
      c.posix.indexOf(" codex"),
    );
  });

  it("planReviewModel + reviewModel unset — emits no review-model env vars", () => {
    const c = buildCodexCommands({ cwd: CWD });
    expect(c.posix).not.toContain("SHIPWRIGHT_CODEX_PLAN_REVIEW_MODEL");
    expect(c.posix).not.toContain("SHIPWRIGHT_CODEX_REVIEW_MODEL");
  });

  it("only reviewModel set — emits just that one env var", () => {
    const c = buildCodexCommands({ cwd: CWD, reviewModel: "gpt-5.6-sol" });
    expect(c.posix).not.toContain("SHIPWRIGHT_CODEX_PLAN_REVIEW_MODEL");
    expect(c.posix).toContain("SHIPWRIGHT_CODEX_REVIEW_MODEL='gpt-5.6-sol'");
  });

  it("review-model overrides thread through a resume launch too", () => {
    const c = buildCodexCommands({
      cwd: CWD,
      resume: true,
      threadId: THREAD_ID,
      planReviewModel: "gpt-5.6-terra",
      reviewModel: "gpt-5.6-sol",
    });
    expect(c.posix).toContain("codex resume");
    expect(c.posix).toContain("SHIPWRIGHT_CODEX_PLAN_REVIEW_MODEL='gpt-5.6-terra'");
    expect(c.posix).toContain("SHIPWRIGHT_CODEX_REVIEW_MODEL='gpt-5.6-sol'");
  });

  it("review-model values are shell-quoted per shell form (cmd, powershell)", () => {
    const c = buildCodexCommands({
      cwd: CWD,
      planReviewModel: "gpt-5.6-terra",
      reviewModel: "gpt-5.6-sol",
    });
    expect(c.cmd).toContain(`set "SHIPWRIGHT_CODEX_PLAN_REVIEW_MODEL=gpt-5.6-terra"`);
    expect(c.cmd).toContain(`set "SHIPWRIGHT_CODEX_REVIEW_MODEL=gpt-5.6-sol"`);
    expect(c.powershell).toContain(
      `$env:SHIPWRIGHT_CODEX_PLAN_REVIEW_MODEL = 'gpt-5.6-terra';`,
    );
    expect(c.powershell).toContain(
      `$env:SHIPWRIGHT_CODEX_REVIEW_MODEL = 'gpt-5.6-sol';`,
    );
  });

  it("review-model prefix composes with an implementationModel override", () => {
    const c = buildCodexCommands({
      cwd: CWD,
      implementationModel: "gpt-5.6-luna",
      planReviewModel: "gpt-5.6-terra",
      reviewModel: "gpt-5.6-sol",
    });
    expect(c.posix).toContain("SHIPWRIGHT_CODEX_PLAN_REVIEW_MODEL='gpt-5.6-terra'");
    expect(c.posix).toContain("SHIPWRIGHT_CODEX_REVIEW_MODEL='gpt-5.6-sol'");
    expect(c.posix).toContain(`-c 'model="gpt-5.6-luna"'`);
  });

  // iterate-2026-09-19-codex-launch-powershell-chunk (bug fix): reproduced
  // live against a real pwsh.exe pty (PowerShell 7) -- PSReadLine, fed a
  // multi-line single-quoted string via pty keystroke injection (not a real
  // interactive paste), corrupts its edit buffer and executes a fragment of
  // the prompt text as a bare command (e.g. the literal parenthetical
  // "(done:false if you could not complete it)" in the status-report
  // instruction runs as `done:false: The term 'done:false' is not
  // recognized...`). Confirmed independent of chunking (fails identically
  // via one atomic pty.write()) and independent of bracketed paste (PS7's
  // bracketed-paste handling does not prevent it either) -- the only thing
  // that avoids it is never putting a literal newline in the bytes sent to
  // the pty. buildCodexPrompt() always joins its lines with blank-line
  // separators, so every Codex launch (guided AND autonomous) hits this.
  // Mirrors launcher.ts's existing "Title cannot contain newlines (would
  // break the single-line copy-paste flow)" guard for the Claude launcher.
  it("powershell form contains no raw newline even for a multi-paragraph prompt (PSReadLine corruption guard)", () => {
    const c = buildCodexCommands({
      cwd: CWD,
      phase: "iterate",
      description: "Line one of the task.\n\nLine two, after a blank line.",
      hasAgentsMd: false,
    });
    expect(c.powershell).not.toMatch(/[\r\n]/);
  });

  it("powershell form decodes back to the exact original multi-line prompt", () => {
    const description = "Line one of the task.\n\nLine two, after a blank line.";
    const c = buildCodexCommands({ cwd: CWD, phase: "iterate", description, hasAgentsMd: false });
    const match = c.powershell.match(/FromBase64String\('([^']+)'\)/);
    expect(match).not.toBeNull();
    const decoded = Buffer.from(match![1], "base64").toString("utf8");
    expect(decoded).toContain(description);
    expect(decoded).toContain("SHIPWRIGHT-STATUS");
  });

  it("cmd and posix forms are untouched -- the fix is scoped to PowerShell only", () => {
    const description = "Line one of the task.\n\nLine two, after a blank line.";
    const c = buildCodexCommands({ cwd: CWD, phase: "iterate", description, hasAgentsMd: false });
    expect(c.posix).toContain(description);
    expect(c.cmd).toContain(description);
  });

});

describe("launcher-codex.buildCodexPrompt", () => {
  it("no AGENTS.md → inlines model pins + review-cascade authorization", () => {
    const prompt = buildCodexPrompt({ phase: "build", hasAgentsMd: false });
    expect(prompt).toMatch(/gpt-5\.6-terra/);
    expect(prompt).toMatch(/gpt-5\.6-sol/);
    expect(prompt).toMatch(/review cascade/i);
  });

  it("no AGENTS.md, phase set → also points at the phase's SKILL.md", () => {
    const prompt = buildCodexPrompt({ phase: "build", hasAgentsMd: false });
    expect(prompt).toContain("shipwright-build/skills/build/SKILL.md");
  });

  it("AGENTS.md present, phase=iterate → omits both the pins AND the SKILL.md pointer", () => {
    const prompt = buildCodexPrompt({ phase: "iterate", hasAgentsMd: true });
    expect(prompt).not.toMatch(/gpt-5\.6-terra/);
    expect(prompt).not.toContain("SKILL.md");
  });

  it("AGENTS.md present, phase=build (not iterate) → still points at build's SKILL.md", () => {
    const prompt = buildCodexPrompt({ phase: "build", hasAgentsMd: true });
    expect(prompt).not.toMatch(/gpt-5\.6-terra/); // AGENTS.md already carries the pins
    expect(prompt).toContain("shipwright-build/skills/build/SKILL.md");
  });

  it("always ends with a SHIPWRIGHT-STATUS self-report instruction (§5.4)", () => {
    const prompt = buildCodexPrompt({ phase: "test", hasAgentsMd: false });
    expect(prompt).toContain("SHIPWRIGHT-STATUS");
  });

  it("includes the description as the task brief", () => {
    const prompt = buildCodexPrompt({ description: "Fix the flaky retry test." });
    expect(prompt).toContain("Fix the flaky retry test.");
  });
});
