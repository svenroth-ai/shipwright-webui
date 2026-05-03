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
}

function clampPositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
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
  };
}
