/**
 * Resolve the Tailscale IPv4 address for the current host. Two paths:
 *
 *   1. SHIPWRIGHT_TAILSCALE_IP env var — explicit user override. Strict
 *      IPv4 validation via node:net.isIPv4 (no permissive regex; rejects
 *      out-of-bounds octets like 999.x.x.x).
 *   2. `tailscale ip -4` subprocess. Parses stdout, splits on /\r?\n/
 *      (Windows CRLF), returns the FIRST VALID IPv4 line. 2-second
 *      timeout via execSync options so a stuck Tailscale daemon does
 *      not freeze the server boot.
 *
 * Loud-fail with an actionable error message when neither path yields
 * a valid IPv4. The error names the env-var fallback path explicitly
 * so the user can recover without reading source.
 *
 * `exec` is dependency-injected so tests can stub the subprocess.
 * Production code passes `child_process.execSync`.
 *
 * Mirror of `client/src/lib/resolveTailscaleIp.ts` — keep in sync
 * (cross-mirror parity asserted by `network-profile-sync.test.ts`).
 *
 * See ADR-08X (network-profile-flag).
 */

import { isIPv4 } from "node:net";

export type TailscaleIpExec = (cmd: string, opts?: object) => string;

const TAILSCALE_CMD = "tailscale ip -4";
const EXEC_OPTS = { encoding: "utf8", timeout: 2000 } as const;

function actionableError(reason: string): Error {
  return new Error(
    `[resolveTailscaleIp] ${reason}. ` +
      `Set SHIPWRIGHT_TAILSCALE_IP=<your-tailscale-ipv4> in .env.local ` +
      `as a fallback, or ensure the \`tailscale\` CLI is on PATH and ` +
      `Tailscale is connected.`,
  );
}

export function resolveTailscaleIp(
  env: Record<string, string | undefined>,
  exec: TailscaleIpExec,
): string {
  const override = env.SHIPWRIGHT_TAILSCALE_IP?.trim();
  if (override) {
    if (!isIPv4(override)) {
      throw actionableError(
        `SHIPWRIGHT_TAILSCALE_IP="${override}" is not a valid IPv4 address`,
      );
    }
    return override;
  }

  let stdout: string;
  try {
    stdout = String(exec(TAILSCALE_CMD, EXEC_OPTS));
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code ?? "";
    const reason =
      code === "ENOENT"
        ? "tailscale CLI not found on PATH"
        : code === "ETIMEDOUT"
          ? "tailscale CLI timed out (>2s)"
          : `tailscale CLI failed (${(err as Error).message})`;
    throw actionableError(reason);
  }

  const lines = stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  for (const line of lines) {
    if (isIPv4(line)) return line;
  }

  throw actionableError("`tailscale ip -4` returned no IPv4 lines");
}
