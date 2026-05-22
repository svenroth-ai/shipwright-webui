import path, { dirname } from "path";
import { fileURLToPath } from "url";
import os from "os";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface ServerConfig {
  port: number;
  maxConcurrent: number;
  registryDir: string;
  heartbeatIntervalMs: number;
  staticDir: string;
  /** Embedded terminal — keep last N image-pastes per task.cwd. Default 20. */
  claudePastesKeepLast: number;
  /** Per-WebSocket outbound buffer cap (bytes) before drop-oldest backpressure kicks in. Default 1 MiB. */
  terminalWsBufferBytes: number;
  /** PTY auto-kill ceiling: max idle (no read AND no write) before forced kill. Default 30 min. */
  terminalIdleTimeoutMs: number;
  /** Test-only override for the spawn target. Whitelist still enforced; only honored when NODE_ENV === "test". */
  ptyShellOverride?: string;
  /**
   * Iterate-2026-05-04 (ADR-068-A1) — disk-backed terminal scrollback.
   * Directory where per-task scrollback files (`<taskId>.log`) are persisted.
   * Default: `<registryDir>/terminal-scrollback`.
   */
  terminalScrollbackDir: string;
  /**
   * Per-task scrollback rotation cap (bytes). When append-cumulative exceeds
   * this threshold, `.log` rotates to `.log.1` (atomic). Default 1 MiB.
   * Set to 0 to DISABLE persistence entirely (no file creation, no replay).
   */
  terminalScrollbackMaxBytes: number;
  /**
   * Time-to-live for orphan scrollback files (whole days). Boot + daily sweep
   * deletes files older than this. Default 1 day (privacy-first).
   */
  terminalScrollbackTtlDays: number;
  /** Bound on TTL sweep per pass — protects against unbounded boot work on huge dirs. Default 100. */
  terminalSweepMaxFilesPerPass: number;
  /**
   * Iterate-2026-05-11 (ADR-088 / ADR-089) — @xterm/headless mirror
   * shadow-write + snapshot-based replay. When enabled, every live pty
   * has a server-side headless Terminal mirror; on pty.kill the M2
   * double-serialize snapshot is persisted; on WS attach the snapshot
   * is replayed via a single `replay_snapshot` envelope (legacy chunked
   * scrollback is the fallback for tasks created before the flag
   * landed, or when the snapshot's terminalVersion does not match).
   *
   * Iterate B (ADR-089): default flipped from OFF to ON. Opt-out is
   * `SHIPWRIGHT_TERMINAL_HEADLESS_MIRROR=0`. Plan-of-record:
   * `.shipwright/planning/embedded-terminal-refactor-headless.md`.
   */
  terminalHeadlessMirror: boolean;
  /**
   * Iterate G (ADR-095) — Claude TUI flicker workaround. When `true`,
   * every pty spawned for the embedded terminal carries
   * `CLAUDE_CODE_NO_FLICKER=1` in its env, instructing Claude Code to
   * render into the alt-screen buffer (vim/htop-style) and bypass the
   * per-frame ANSI cursor moves that xterm.js can't batch unless the
   * producer wraps frames in DECSET 2026 / Synchronized Output.
   *
   * Iterate I (ADR-097) tried flipping the default OFF on the
   * hypothesis that xterm.js 6.0.0's native DECSET 2026 support would
   * batch Claude TUI's main-buffer frames flicker-free. Iterate J
   * (ADR-098) falsified that hypothesis empirically: a 265 711-byte
   * live Claude Code 2.1.139 scrollback contains ZERO `\x1b[?2026h`
   * or `\x1b[?2026l` sequences (21 690 raw CUP sequences, but no
   * Synchronized-Output bracket pairs). Claude Code does not wrap
   * its frames; xterm 6's native sync support has nothing to batch.
   * Claude Code Issue #37283 remains open at the time of ADR-098.
   *
   * Therefore: default is RESTORED to ON. Opt-out via
   * `SHIPWRIGHT_TERMINAL_NO_FLICKER=0` (empty / unset / `"1"` / any
   * other value → injected). Trade-off retained: alt-screen mode
   * costs browser-native Cmd+F of conversation history, mouse
   * capture, fixed input box — accepted because visible flicker
   * degrades every streaming response. Docs:
   * https://code.claude.com/docs/en/fullscreen.
   *
   * The field is for diagnostics + structured logging. The actual env
   * injection lives in `terminal/routes.ts buildSpawnEnv` which reads
   * `process.env.SHIPWRIGHT_TERMINAL_NO_FLICKER` directly so the spawn
   * factory does not have to thread a `ServerConfig` reference.
   */
  terminalNoFlicker: boolean;
}

function clampPositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Like clampPositiveInt but accepts 0 (used for "disabled" semantics). */
function clampNonNegativeInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === "") return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export function getConfig(): ServerConfig {
  return {
    port: parseInt(process.env.PORT ?? "3847", 10),
    maxConcurrent: parseInt(
      process.env.SHIPWRIGHT_MAX_CONCURRENT ?? "3",
      10
    ),
    registryDir: path.join(os.homedir(), ".shipwright-webui"),
    heartbeatIntervalMs: 30_000,
    // SHIPWRIGHT_STATIC_DIR — test-only seam so spa-fallback.test.ts can
    // point at a fixture instead of requiring a real `client/dist` build.
    // Production deploy keeps the default (server/../client/dist).
    staticDir:
      process.env.SHIPWRIGHT_STATIC_DIR ??
      path.resolve(__dirname, "../../client/dist"),
    claudePastesKeepLast: clampPositiveInt(
      process.env.SHIPWRIGHT_CLAUDE_PASTES_KEEP_LAST,
      20,
    ),
    terminalWsBufferBytes: clampPositiveInt(
      process.env.SHIPWRIGHT_TERMINAL_WS_BUFFER_BYTES,
      1_048_576,
    ),
    terminalIdleTimeoutMs: clampPositiveInt(
      process.env.SHIPWRIGHT_TERMINAL_IDLE_TIMEOUT_MS,
      1_800_000,
    ),
    ptyShellOverride:
      process.env.NODE_ENV === "test"
        ? process.env.SHIPWRIGHT_PTY_SHELL_OVERRIDE
        : undefined,
    terminalScrollbackDir:
      process.env.SHIPWRIGHT_TERMINAL_SCROLLBACK_DIR ??
      path.join(os.homedir(), ".shipwright-webui", "terminal-scrollback"),
    terminalScrollbackMaxBytes: clampNonNegativeInt(
      process.env.SHIPWRIGHT_TERMINAL_SCROLLBACK_MAX_BYTES,
      1_048_576,
    ),
    terminalScrollbackTtlDays: clampPositiveInt(
      process.env.SHIPWRIGHT_TERMINAL_SCROLLBACK_TTL_DAYS,
      1,
    ),
    terminalSweepMaxFilesPerPass: clampPositiveInt(
      process.env.SHIPWRIGHT_TERMINAL_SWEEP_MAX_FILES_PER_PASS,
      100,
    ),
    // ADR-089 (Iterate B) — default ON. Opt-out by setting the env var
    // to `0`. Empty / unset / any value other than `0` enables the
    // mirror + snapshot path. Test bypass: NODE_ENV-aware overrides
    // could be added later; for now there is no need (the production
    // path is default-on; tests construct PtyManager / routes with
    // their own flags).
    terminalHeadlessMirror:
      process.env.SHIPWRIGHT_TERMINAL_HEADLESS_MIRROR !== "0",
    // Iterate J (ADR-098) — default restored to ON after empirical
    // verification (265 KB live Claude Code 2.1.139 scrollback: zero
    // DECSET 2026 sequences in main-buffer rendering). xterm 6.0's
    // native sync-output honour has nothing to batch because Claude
    // Code does not wrap its frames; ADR-097's opt-in default was the
    // wrong inference. Opt-out via `SHIPWRIGHT_TERMINAL_NO_FLICKER=0`
    // (any other value → enabled, matching the inverted-falsy "0"
    // convention used by `terminalHeadlessMirror`). Iterate G's
    // ADR-095 default-on stance is restored verbatim. Claude Code
    // Issue #37283 remains open; revisit when DECSET 2026 is emitted
    // by Claude itself.
    terminalNoFlicker: process.env.SHIPWRIGHT_TERMINAL_NO_FLICKER !== "0",
  };
}
