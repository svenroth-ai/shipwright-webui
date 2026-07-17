/*
 * A18 — the terminal byte-path FENCES, asserted as code (AC3).
 *
 * A18 restyles the shell AROUND the embedded terminal into three cards. That
 * restyle is allowed to move every pixel; it is NOT allowed to touch the pty's
 * byte path. The E2E `terminal-byte-path-guard.spec.ts` (A00) pins the outbound
 * WS frames at runtime; THIS test pins — as static, always-runnable assertions —
 * the config the restyle must not move:
 *
 *   1. xterm.js + the three paired addons stay EXACT-pinned (no carets, the
 *      6.0.0 family). CLAUDE.md rule 22 / ADR-097 + ADR-098.
 *   2. `windowsMode` appears NOWHERE in the terminal source. Rule 22.
 *   3. `convertEol` is `false` (Bug B smear fence). Rule 22.
 *   4. The pty spawn whitelist is a closed set of SHELLS and never `claude`.
 *      CLAUDE.md rule 1 / DO-NOT #17 / ADR-067.
 *
 * Prove it bites (RED-first, recorded in the iterate ADR): flip `convertEol` to
 * `true` in `xterm-theme-options.ts`, or add a caret to an xterm pin in
 * `client/package.json`, and this test goes RED. That is the tripwire A18 works
 * next to. The answer to a RED here is to change the RESTYLE, never this guard.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const dir = path.dirname(fileURLToPath(import.meta.url)); // client/src/test
const clientRoot = path.join(dir, "..", ".."); // client/
const repoRoot = path.join(clientRoot, ".."); // shipwright-webui/

const terminalDir = path.join(clientRoot, "src/components/terminal");

// Every non-test source file under the terminal tree, concatenated — so a fence
// that "appears nowhere" is checked against the WHOLE tree, not two files.
function readTerminalSource(): string {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
        out.push(readFileSync(full, "utf8"));
      }
    }
  };
  walk(terminalDir);
  return out.join("\n");
}
const terminalSource = readTerminalSource();
const terminalSocket = readFileSync(
  path.join(clientRoot, "src/hooks/useTerminalSocket.ts"),
  "utf8",
);

const pkg = JSON.parse(
  readFileSync(path.join(clientRoot, "package.json"), "utf8"),
) as { dependencies?: Record<string, string> };

const themeOpts = readFileSync(
  path.join(clientRoot, "src/components/terminal/xterm-theme-options.ts"),
  "utf8",
);
const ptyManager = readFileSync(
  path.join(repoRoot, "server/src/terminal/pty-manager.ts"),
  "utf8",
);

describe("A18 fence — xterm + addons are EXACT-pinned (rule 22 / ADR-097/098)", () => {
  // The 6.0.0 family, verbatim. A caret (^) or a bumped version fails: the
  // snapshot envelope v2 gate + the WebGL atlas fixes are pinned to this set.
  const PINS: Record<string, string> = {
    "@xterm/xterm": "6.0.0",
    "@xterm/addon-fit": "0.11.0",
    "@xterm/addon-webgl": "0.19.0",
    "@xterm/addon-web-links": "0.12.0",
  };

  for (const [name, version] of Object.entries(PINS)) {
    it(`${name} is pinned EXACTLY to ${version} (no caret / tilde / range)`, () => {
      const declared = pkg.dependencies?.[name];
      expect(declared, `${name} missing from client dependencies`).toBe(version);
      // Belt-and-braces: no range operator smuggled in.
      expect(/^[\^~>=<]/.test(declared ?? "")).toBe(false);
    });
  }
});

describe("A18 fence — terminal byte-path options are frozen (rule 22)", () => {
  it("convertEol is false in xterm-theme-options.ts (Bug B smear fence)", () => {
    // Match the PROPERTY assignment (trailing comma) — a doc comment may
    // discuss "convertEol:true would smear", which is not the property.
    expect(themeOpts).toMatch(/convertEol:\s*false\s*,/);
    expect(themeOpts).not.toMatch(/convertEol:\s*true\s*,/);
  });

  it("windowsMode is never SET as an option ANYWHERE in the terminal tree (rule 22)", () => {
    // A comment may name the rule ("DO NOT add windowsMode"); what must not
    // exist — in ANY terminal source file — is the PROPERTY assignment
    // `windowsMode:` on an options object.
    expect(terminalSource).not.toMatch(/windowsMode\s*:/);
  });
});

describe("A18 fence — replay is cell-state-snapshot ONLY, chunked path retired (rule 20/21 / ADR-087/092/097)", () => {
  it("the client consumes the `replay_snapshot` envelope (the sole replay primitive)", () => {
    expect(terminalSocket).toContain("replay_snapshot");
    // Versioned by terminalVersion (ADR-097 v2 envelope), not a chunk stream.
    expect(terminalSocket).toContain("terminalVersion");
  });

  it("no chunked-replay path is ACTIVELY handled (the retired primitive)", () => {
    // A comment may document that the chunked path is RETIRED (ADR-087); what must
    // not exist is an ACTIVE gate on the retired type. The live gate is
    // `env.type === "replay_snapshot"` (the sole primitive).
    expect(terminalSocket).toMatch(/env\.type\s*===\s*["']replay_snapshot["']/);
    expect(terminalSocket).not.toMatch(
      /env\.type\s*===\s*["'](replay_chunk|replay_start|replay_end)["']/,
    );
  });
});

describe("A18 fence — pty spawn target is a whitelisted SHELL, never claude (rule 1 / ADR-067)", () => {
  it("ShellKind is the closed { pwsh | cmd | posix } set", () => {
    expect(ptyManager).toMatch(
      /export type ShellKind\s*=\s*"pwsh"\s*\|\s*"cmd"\s*\|\s*"posix"/,
    );
  });

  it("the spawn whitelist contains only shells and never `claude`", () => {
    const block = ptyManager.slice(
      ptyManager.indexOf("const WHITELIST"),
      ptyManager.indexOf("]", ptyManager.indexOf("const WHITELIST")),
    );
    expect(block.length).toBeGreaterThan(0);
    expect(block.toLowerCase()).not.toContain("claude");
    // The known-good shells are all present (a spawn target cannot appear
    // without editing this list, which this assertion pins).
    for (const shell of ["pwsh", "cmd", "bash", "zsh", "sh", "fish"]) {
      expect(block).toContain(`"${shell}"`);
    }
  });
});
