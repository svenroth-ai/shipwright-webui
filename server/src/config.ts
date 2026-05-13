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
   * Iterate G (ADR-095) — Claude TUI flicker workaround. When `true`
   * (default), every pty spawned for the embedded terminal carries
   * `CLAUDE_CODE_NO_FLICKER=1` in its env, instructing Claude Code to
   * render into the alt-screen buffer (vim/htop-style) and bypass the
   * per-frame ANSI cursor moves that xterm.js 5.5.0 can't batch
   * (no DECSET 2026 support). Opt-out via
   * `SHIPWRIGHT_TERMINAL_NO_FLICKER=0` for users who prefer the
   * classic renderer (e.g. to preserve browser Cmd+F search). Docs:
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
    staticDir: path.resolve(__dirname, "../../client/dist"),
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
    // Iterate G (ADR-095) — Claude TUI flicker workaround. Default ON;
    // opt-out via `SHIPWRIGHT_TERMINAL_NO_FLICKER=0`. Same parse rule
    // as `terminalHeadlessMirror` (empty / unset / any value other
    // than literal "0" → enabled).
    terminalNoFlicker: process.env.SHIPWRIGHT_TERMINAL_NO_FLICKER !== "0",
  };
}
