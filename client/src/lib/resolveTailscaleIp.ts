/**
 * Mirror of `server/src/lib/resolveTailscaleIp.ts` — keep in sync.
 *
 * Resolve the Tailscale IPv4 address. SHIPWRIGHT_TAILSCALE_IP env-var
 * wins; else `tailscale ip -4` subprocess; loud-fail otherwise.
 * Strict IPv4 validation via `node:net.isIPv4` (not regex). 2-second
 * timeout on the subprocess. Used by `resolveProxyTarget.ts` and
 * `resolveViteHost.ts` (transitively via `resolveNetworkProfile.ts`)
 * — all of those run only at vite-config / build time on the Node
 * side, never in the browser bundle.
 *
 * Cross-mirror parity asserted by
 * `server/src/lib/network-profile-sync.test.ts`.
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
