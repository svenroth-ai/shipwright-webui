/**
 * probes.mjs — low-level, self-contained runtime probes used by server.mjs.
 *
 * Kept apart from the boot/attach/swap orchestration so each stays focused and
 * under the 300-line ceiling: this file owns "is the port occupied?" and "can
 * the native terminal load?", server.mjs owns what to DO about the answers.
 */

import net from "node:net";

/**
 * TCP-connect to 127.0.0.1:port. `connected` → the port is OCCUPIED (by
 * anything); ECONNREFUSED → FREE. A connect timeout is treated as free (a
 * filtered localhost port does not occur in practice; erring toward free avoids
 * a false-foreign that would block boot on a genuinely open port).
 * @returns {Promise<boolean>} occupied
 */
export function tcpOccupied(port, { host = "127.0.0.1", timeoutMs = 1500 } = {}) {
  return new Promise((resolve) => {
    const sock = net.connect({ port, host });
    let settled = false;
    const done = (occupied) => {
      if (settled) return;
      settled = true;
      sock.destroy();
      resolve(occupied);
    };
    sock.setTimeout(timeoutMs);
    sock.once("connect", () => done(true));
    sock.once("timeout", () => done(false));
    sock.once("error", () => done(false)); // ECONNREFUSED = nothing listening
  });
}

/**
 * Verify @lydell/node-pty's NATIVE binary actually loads. It is the only native
 * piece of the packaged server; if it fails to resolve a binding, the Command
 * Center boots with a terminal that cannot spawn — a silent half-death. Probe
 * it (in the bootstrapper process, a same-platform proxy for the server) and
 * fail LOUD before booting, never after (spec §1).
 * @param {(m: string) => Promise<any>} [importFn]
 * @returns {Promise<{ ok: boolean, error: string | null }>}
 */
export async function checkNativePty(importFn = (m) => import(m)) {
  try {
    const mod = await importFn("@lydell/node-pty");
    const spawnFn = mod?.spawn ?? mod?.default?.spawn;
    if (typeof spawnFn !== "function") return { ok: false, error: "loaded but exposes no spawn()" };
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: String(e?.message ?? e) };
  }
}
