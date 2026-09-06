import { describe, it, expect } from "vitest";

import {
  armActionTemplatePermissionPerimeter,
  templateDeclaresSessionIdAnchor,
} from "./claim-executor-template-arming.js";
import { claimExecutorLaunchOverrides } from "./claim-executor-permissions.js";
import type { CopyCommandForms } from "../../core/launcher.js";

const UUID = "11111111-1111-4111-8111-111111111111";

function bundledDefaultShape(uuid: string): CopyCommandForms {
  // Mirrors config/default-actions.json's own command_template shape as
  // ACTUALLY rendered by substitutePlaceholders — {task.uuid} comes out
  // UNQUOTED on every shell form (verified live via a debug probe against
  // the real substitution engine; only user-derived placeholders like
  // {task.session_name} get shell-quoted).
  return {
    powershell: `Set-Location '/repo' -ErrorAction Stop; claude --session-id ${uuid} --name 'my task' --plugin-dir '/p1' '/shipwright-iterate "desc"'`,
    cmd: `cd /d "/repo" && claude --session-id ${uuid} --name "my task" --plugin-dir "/p1" "/shipwright-iterate \\"desc\\""`,
    posix: `cd '/repo' && claude --session-id ${uuid} --name 'my task' --plugin-dir '/p1' '/shipwright-iterate "desc"'`,
  };
}

describe("armActionTemplatePermissionPerimeter", () => {
  it("inserts --tools and --permission-mode right after --session-id <uuid> on all three shell forms", () => {
    const commands = bundledDefaultShape(UUID);
    const result = armActionTemplatePermissionPerimeter(commands, UUID, claimExecutorLaunchOverrides());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const shellForm of ["powershell", "cmd", "posix"] as const) {
      expect(result.commands[shellForm]).toMatch(/--tools\s+["']Bash,Read,Write,Edit,Glob,Grep["']/);
      expect(result.commands[shellForm]).toMatch(/--permission-mode\s+["']dontAsk["']/);
      // The rest of the original command (--name, --plugin-dir, the trailing
      // slash-command positional) survives, unaltered, after the insertion.
      expect(result.commands[shellForm]).toContain("--plugin-dir");
      expect(result.commands[shellForm]).toContain("shipwright-iterate");
    }
  });

  it("the inserted flags land BEFORE --name (immediately after --session-id, not appended at the end)", () => {
    const commands = bundledDefaultShape(UUID);
    const result = armActionTemplatePermissionPerimeter(commands, UUID, claimExecutorLaunchOverrides());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const toolsIdx = result.commands.posix.indexOf("--tools");
    const nameIdx = result.commands.posix.indexOf("--name");
    expect(toolsIdx).toBeGreaterThan(0);
    expect(toolsIdx).toBeLessThan(nameIdx);
  });

  it("fails closed (ok:false) when a custom template has no --session-id <this task's uuid> anchor", () => {
    const commands: CopyCommandForms = {
      powershell: `& claude --name 'custom template with no session-id flag'`,
      cmd: `claude --name "custom template with no session-id flag"`,
      posix: `claude --name 'custom template with no session-id flag'`,
    };
    const result = armActionTemplatePermissionPerimeter(commands, UUID, claimExecutorLaunchOverrides());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.detail).toContain(UUID);
  });

  it("fails closed when the anchor uuid belongs to a DIFFERENT session than the one being armed", () => {
    const otherUuid = "22222222-2222-4222-8222-222222222222";
    const commands = bundledDefaultShape(otherUuid);
    const result = armActionTemplatePermissionPerimeter(commands, UUID, claimExecutorLaunchOverrides());
    expect(result.ok).toBe(false);
  });

  it("fails closed when the --session-id anchor appears more than once (e.g. a caller-supplied description contains this task's own uuid)", () => {
    // A custom command_template that puts {task.description?} BEFORE
    // {task.uuid}: if the description happens to contain the literal
    // "--session-id <this task's uuid>" text, indexOf's first match would
    // land inside the untrusted description instead of the real flag —
    // the "looks armed, isn't" failure this module exists to prevent.
    const commands: CopyCommandForms = {
      powershell: `claude --name 'x' 'fake --session-id ${UUID} text' --session-id ${UUID}`,
      cmd: `claude --name "x" "fake --session-id ${UUID} text" --session-id ${UUID}`,
      posix: `claude --name 'x' 'fake --session-id ${UUID} text' --session-id ${UUID}`,
    };
    const result = armActionTemplatePermissionPerimeter(commands, UUID, claimExecutorLaunchOverrides());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.detail).toContain("not unique");
  });

  it("fails closed when the rendered command already contains a --tools or --permission-mode flag before arming", () => {
    // A custom command_template whose OWN {task.parameters?} rendering
    // happens to declare a --tools flag (schema cli_flag allowlist permits
    // it) ahead of --session-id. Arming on top of this risks a
    // duplicate/conflicting flag whose CLI precedence is unverified.
    const commands: CopyCommandForms = {
      powershell: `claude --tools 'Read' --session-id ${UUID} --name 'x'`,
      cmd: `claude --tools "Read" --session-id ${UUID} --name "x"`,
      posix: `claude --tools 'Read' --session-id ${UUID} --name 'x'`,
    };
    const result = armActionTemplatePermissionPerimeter(commands, UUID, claimExecutorLaunchOverrides());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.detail).toContain("already contains");
  });
});

describe("templateDeclaresSessionIdAnchor", () => {
  it("true for a raw template that literally declares the {task.uuid} placeholder after --session-id", () => {
    expect(templateDeclaresSessionIdAnchor("{cd.prefix}claude --session-id {task.uuid} --name {task.session_name}")).toBe(true);
  });

  it("false for a template with no --session-id {task.uuid} placeholder at all (e.g. --resume instead)", () => {
    expect(templateDeclaresSessionIdAnchor("claude --resume {task.uuid} {task.description?}")).toBe(false);
  });

  it("false for a template using a different placeholder spacing/shape", () => {
    expect(templateDeclaresSessionIdAnchor("claude --session-id={task.uuid}")).toBe(false);
  });
});
