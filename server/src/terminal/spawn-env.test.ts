/*
 * spawn-env.test.ts — F17 (deep-audit 2026-07-10, sub-iterate D12):
 * strip the webui's OWN operational network vars from the embedded-pty env.
 *
 * Root cause: `buildSpawnEnv` spreads the whole webui SERVER process.env
 * into every embedded-terminal pty and previously stripped only
 * FORCE_COLOR + the CLAUDE_CODE_* parent-session markers. The production
 * launchers stamp PORT explicitly — start-server-production.sh runs
 * `PORT="$PORT" nohup node ...` (default 3847) and install-windows.ps1's
 * autostart runs `cmd /c set PORT=3847 && node ...`. So a PORT-honouring
 * user dev server started INSIDE the embedded terminal (e.g. `npm run dev`
 * for another webui / a Vite app) inherits PORT=3847 and collides with the
 * webui itself. VITE_PORT + HONO_HOST are the sibling network vars with the
 * same leak.
 *
 * Fix: extend the strip-list so PORT / VITE_PORT / HONO_HOST are deleted
 * from the pty env AFTER the base+caller merge — neither the server's own
 * env nor a caller can leak them into the child shell. The pty gets a clean
 * network slate; the user's dev server picks its own default port.
 *
 * Scope note: only the three webui NETWORK vars are stripped. The webui's
 * other SHIPWRIGHT_TERMINAL_* config vars are consumed by buildSpawnEnv
 * itself (SHIPWRIGHT_TERMINAL_NO_FLICKER / _LEGACY_BRAND_COLORS) or are
 * harmless to a nested shell, and SHIPWRIGHT_WEBUI is set intentionally —
 * a blanket SHIPWRIGHT_* sweep would be scope creep that breaks those
 * contracts (see spawn-env.ts strip-list comment). The flicker / color /
 * marker semantics remain pinned in pty-env-flicker.test.ts.
 */

import { describe, expect, it } from "vitest";
import { buildSpawnEnv } from "./spawn-env.js";

describe("buildSpawnEnv — strip webui operational network vars (F17, D12)", () => {
  // @covers FR-01.28
  it("strips PORT inherited from the webui server's own env (the collision trigger)", () => {
    // The production launchers stamp PORT=3847; without the strip a
    // PORT-honouring dev server started in the embedded terminal would
    // bind 3847 and collide with the webui.
    const baseEnv: Record<string, string | undefined> = {
      PATH: "/usr/bin",
      PORT: "3847",
    };
    const env = buildSpawnEnv(baseEnv);
    expect("PORT" in env).toBe(false);
  });

  // @covers FR-01.28
  it("strips VITE_PORT and HONO_HOST too (sibling network vars)", () => {
    const baseEnv: Record<string, string | undefined> = {
      PATH: "/usr/bin",
      PORT: "3847",
      VITE_PORT: "5173",
      HONO_HOST: "true",
    };
    const env = buildSpawnEnv(baseEnv);
    expect("PORT" in env).toBe(false);
    expect("VITE_PORT" in env).toBe(false);
    expect("HONO_HOST" in env).toBe(false);
  });

  // @covers FR-01.28
  it("a caller-supplied env cannot re-leak the network vars", () => {
    // Symmetric to the parent-session-marker strip: the delete runs AFTER
    // the caller merge, so neither the base env nor the caller can seed a
    // stale PORT/VITE_PORT/HONO_HOST into the child shell.
    const baseEnv: Record<string, string | undefined> = { PATH: "/usr/bin" };
    const callerEnv = {
      PORT: "3847",
      VITE_PORT: "5173",
      HONO_HOST: "127.0.0.1",
      KEEP_ME: "yes",
    };
    const env = buildSpawnEnv(baseEnv, callerEnv);
    expect("PORT" in env).toBe(false);
    expect("VITE_PORT" in env).toBe(false);
    expect("HONO_HOST" in env).toBe(false);
    // unrelated caller vars still flow through
    expect(env.KEEP_ME).toBe("yes");
  });

  // @covers FR-01.28
  it("leaves unrelated vars untouched (surgical strip, not a blanket sweep)", () => {
    const baseEnv: Record<string, string | undefined> = {
      PATH: "/usr/bin:/bin",
      HOME: "/home/user",
      PORT: "3847",
      // a var that merely CONTAINS 'PORT' as a substring must survive
      SUPPORT_EMAIL: "help@example.test",
      SHIPWRIGHT_MONOREPO_PATH: "/repo/shipwright",
    };
    const env = buildSpawnEnv(baseEnv);
    expect(env.PATH).toBe("/usr/bin:/bin");
    expect(env.HOME).toBe("/home/user");
    expect(env.SUPPORT_EMAIL).toBe("help@example.test");
    expect(env.SHIPWRIGHT_MONOREPO_PATH).toBe("/repo/shipwright");
    expect("PORT" in env).toBe(false);
  });

  // @covers FR-01.28
  it("keeps the other spawn-env contracts intact while stripping ports", () => {
    // Regression fence: the network-var strip must not disturb the
    // SHIPWRIGHT_WEBUI marker, the CLAUDE_CODE_NO_FLICKER default-ON, or
    // the parent-session-marker strip (all pinned in detail in
    // pty-env-flicker.test.ts — re-checked here in one composite case).
    const baseEnv: Record<string, string | undefined> = {
      PATH: "/usr/bin",
      PORT: "3847",
      CLAUDE_CODE_CHILD_SESSION: "1",
      CLAUDE_CODE_SESSION_ID: "c2061135-07fc-474c-9b01-eb23b7142cff",
      CLAUDE_CODE_ENTRYPOINT: "claude-vscode",
      CLAUDECODE: "1",
    };
    const env = buildSpawnEnv(baseEnv);
    expect("PORT" in env).toBe(false);
    expect(env.SHIPWRIGHT_WEBUI).toBe("1");
    expect(env.CLAUDE_CODE_NO_FLICKER).toBe("1");
    // pin the FULL parent-session strip set — the port-strip must not
    // disturb any of them (external code review openai low, D12).
    expect("CLAUDE_CODE_CHILD_SESSION" in env).toBe(false);
    expect("CLAUDE_CODE_SESSION_ID" in env).toBe(false);
    expect("CLAUDE_CODE_ENTRYPOINT" in env).toBe(false);
    expect("CLAUDECODE" in env).toBe(false);
  });

  // @covers FR-01.28
  it("leaves the webui's OWN config knobs (non-network SHIPWRIGHT_*) inheritable", () => {
    // Audit disposition (external review medium, plan + code): the finding is
    // a NETWORK-bind collision. config.ts's other SHIPWRIGHT_* consumers are
    // internal knobs (MAX_CONCURRENT / STATIC_DIR / TERMINAL_* buffers /
    // scrollback / idle / headless-mirror) — none bind a port/host, so none is
    // stripped. This test pins that a non-network SHIPWRIGHT_* var flows
    // through, documenting the narrow-strip decision.
    const baseEnv: Record<string, string | undefined> = {
      PATH: "/usr/bin",
      PORT: "3847",
      SHIPWRIGHT_MAX_CONCURRENT: "3",
    };
    const env = buildSpawnEnv(baseEnv);
    expect("PORT" in env).toBe(false);
    expect(env.SHIPWRIGHT_MAX_CONCURRENT).toBe("3");
  });
});
