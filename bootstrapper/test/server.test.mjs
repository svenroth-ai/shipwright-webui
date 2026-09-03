import { describe, it, expect } from "vitest";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync } from "node:fs";

import {
  probeServer,
  decideAction,
  ensureServer,
  bootSpawnPlan,
  swapperSpawnPlan,
  openBrowserPlan,
  defaultOpenBrowser,
  checkNativePty,
  bootLogPath,
  resolveBootStdio,
  resolveProbeHost,
} from "../lib/server.mjs";

const PKG_VERSION = "0.23.0";

describe("server — AC1c/AC4: decideAction", () => {
  it("free port → boot", () => {
    expect(decideAction({ reachable: false, shipwright: false, version: null }, PKG_VERSION)).toBe("boot");
  });
  it("Shipwright, same version → attach", () => {
    expect(decideAction({ reachable: true, shipwright: true, version: "0.23.0" }, PKG_VERSION)).toBe("attach");
  });
  it("Shipwright, OLDER → swap (a naive attach serves the OLD UI)", () => {
    expect(decideAction({ reachable: true, shipwright: true, version: "0.22.0" }, PKG_VERSION)).toBe("swap");
  });
  it("Shipwright, NEWER → attach (never downgrade)", () => {
    expect(decideAction({ reachable: true, shipwright: true, version: "0.24.0" }, PKG_VERSION)).toBe("attach");
  });
  it("foreign process → foreign", () => {
    expect(decideAction({ reachable: true, shipwright: false, version: null }, PKG_VERSION)).toBe("foreign");
  });

  // Regression (verified 2026-08-23): two `@next` builds share a triple and
  // differ only in `-next.N`. A triple-only compare called them equal and
  // ATTACHED to the stale server, so the freshly published build never ran
  // (new client served, old server code in memory). The swap decision must
  // honour the pre-release tail.
  it("newer -next.N at the SAME triple → swap (was the stale-attach bug)", () => {
    expect(
      decideAction({ reachable: true, shipwright: true, version: "0.24.7-next.0" }, "0.24.7-next.1"),
    ).toBe("swap");
  });
  it("same -next.N → attach (genuinely already this build)", () => {
    expect(
      decideAction({ reachable: true, shipwright: true, version: "0.24.7-next.1" }, "0.24.7-next.1"),
    ).toBe("attach");
  });
  it("older -next.N running → attach (never downgrade to an earlier next)", () => {
    expect(
      decideAction({ reachable: true, shipwright: true, version: "0.24.7-next.2" }, "0.24.7-next.1"),
    ).toBe("attach");
  });
  it("a release running vs a -next package of the same triple → attach (no downgrade)", () => {
    // 0.24.7 (running) outranks 0.24.7-next.9 (package) → never replace the
    // released server with a pre-release of the same triple.
    expect(
      decideAction({ reachable: true, shipwright: true, version: "0.24.7" }, "0.24.7-next.9"),
    ).toBe("attach");
  });
  it("a -next running vs its release package of the same triple → swap (finish the release)", () => {
    expect(
      decideAction({ reachable: true, shipwright: true, version: "0.24.7-next.3" }, "0.24.7"),
    ).toBe("swap");
  });
});

describe("server — AC1c: the swapper spawn PLAN is detached, carries --port, targets deploy-swap", () => {
  it("swapperSpawnPlan is detached + argv correct", () => {
    const plan = swapperSpawnPlan(3847, "/pkg");
    expect(plan.options.detached).toBe(true);
    expect(plan.options.shell).toBe(false);
    expect(plan.args).toContain("--port");
    expect(plan.args).toContain("3847");
    expect(plan.args.some((a) => a.endsWith("deploy-swap.mjs"))).toBe(true);
  });
  it("bootSpawnPlan is detached + points the resolver at the packaged dirs", () => {
    const plan = bootSpawnPlan(3847, "/pkg");
    expect(plan.options.detached).toBe(true);
    expect(plan.options.env.SHIPWRIGHT_STATIC_DIR).toMatch(/client[\\/]dist$/);
    expect(plan.options.env.SHIPWRIGHT_PROFILES_DIR).toMatch(/server[\\/]profiles$/);
    expect(plan.args[0]).toMatch(/server[\\/]dist[\\/]index\.js$/);
  });
});

describe("server — the detached boot writes to the log the failure message names", () => {
  it("bootLogPath is ~/.shipwright-webui/server-manual.log (the path the error tells the user to read)", () => {
    expect(bootLogPath()).toMatch(/[\\/]\.shipwright-webui[\\/]server-manual\.log$/);
  });

  it("resolveBootStdio routes stdout+stderr to the log fd when the log opens", () => {
    // The bug: bootSpawnPlan shipped stdio:'ignore', so the server's crash output
    // (e.g. ERR_MODULE_NOT_FOUND cron-parser) went nowhere and the named log was
    // never written. With a real fd, stdout AND stderr must both target it.
    expect(resolveBootStdio(() => 7)).toEqual(["ignore", 7, 7]);
  });

  it("resolveBootStdio degrades to 'ignore' when the log cannot be opened (logging is best-effort, never blocks boot)", () => {
    expect(resolveBootStdio(() => null)).toBe("ignore");
  });

  it("the boot readiness-timeout error names bootLogPath() — the log that is now actually written", async () => {
    // A boot whose server never becomes ready must point the user at the SAME
    // path the boot spawn writes to. Before this fix the message hardcoded a
    // path that nothing produced.
    await expect(
      ensureServer({
        port: 3847, pkgRoot: "/pkg", packageVersion: PKG_VERSION, timeoutMs: 50,
        probeFn: async () => ({ reachable: false, shipwright: false, version: null }),
        bootServer: () => 111,
        spawnSwapper: () => 999,
        openBrowser: () => {},
        nativePtyCheck: async () => ({ ok: true, error: null }),
      }),
    ).rejects.toThrow(bootLogPath());
  });
});

describe("server — ensureServer orchestration", () => {
  const spies = () => {
    const calls = { boot: 0, swap: 0, open: [] };
    return {
      calls,
      bootServer: () => (calls.boot++, 111),
      spawnSwapper: () => (calls.swap++, 999),
      openBrowser: (u) => calls.open.push(u),
      nativePtyCheck: async () => ({ ok: true, error: null }),
    };
  };

  it("attach: no boot, no swap, browser opened", async () => {
    const s = spies();
    const r = await ensureServer({
      port: 3847, pkgRoot: "/pkg", packageVersion: PKG_VERSION,
      probeFn: async () => ({ reachable: true, shipwright: true, version: "0.23.0" }),
      ...s,
    });
    expect(r.action).toBe("attach");
    expect(s.calls.boot).toBe(0);
    expect(s.calls.swap).toBe(0);
    expect(s.calls.open).toEqual(["http://localhost:3847"]);
  });

  it("boot: spawns server, waits for readiness, opens browser", async () => {
    const s = spies();
    let n = 0;
    const r = await ensureServer({
      port: 3847, pkgRoot: "/pkg", packageVersion: PKG_VERSION, timeoutMs: 2000,
      probeFn: async () => (n++ === 0
        ? { reachable: false, shipwright: false, version: null }   // decide → boot
        : { reachable: true, shipwright: true, version: "0.23.0" }), // ready
      ...s,
    });
    expect(r.action).toBe("boot");
    expect(s.calls.boot).toBe(1);
    expect(s.calls.swap).toBe(0);
    expect(r.pid).toBe(111);
  });

  it("AC1c swap: OLDER server → detached swapper, version flips, PID reported, browser opens", async () => {
    const s = spies();
    let n = 0;
    const r = await ensureServer({
      port: 3847, pkgRoot: "/pkg", packageVersion: PKG_VERSION, timeoutMs: 3000,
      probeFn: async () => (n++ === 0
        ? { reachable: true, shipwright: true, version: "0.22.0" }   // decide → swap
        : { reachable: true, shipwright: true, version: "0.23.0" }), // swapped
      readDeployStatus: () => ({ ok: true, pid: 222 }),
      ...s,
    });
    expect(r.action).toBe("swap");
    expect(s.calls.swap).toBe(1);
    expect(s.calls.boot).toBe(0);            // never a second server
    expect(r.previousVersion).toBe("0.22.0");
    expect(r.version).toBe("0.23.0");        // asserted on version, not "browser opened"
    expect(r.newPid).toBe(222);              // a PID change
  });

  it("swap fires for a newer -next.N at the SAME triple, and readiness needs the EXACT next", async () => {
    // The stale-attach regression, end to end: republishing `@next` at the same
    // triple must drive a real swap, and the swap must not report ready until the
    // port serves the exact `-next.N` (a lingering next.0 must NOT satisfy it).
    const s = spies();
    let n = 0;
    const r = await ensureServer({
      port: 3847, pkgRoot: "/pkg", packageVersion: "0.24.7-next.1", timeoutMs: 3000,
      probeFn: async () => {
        n++;
        if (n === 1) return { reachable: true, shipwright: true, version: "0.24.7-next.0" }; // decide → swap
        if (n === 2) return { reachable: true, shipwright: true, version: "0.24.7-next.0" }; // still stale — NOT ready
        return { reachable: true, shipwright: true, version: "0.24.7-next.1" };              // swapped in
      },
      readDeployStatus: () => ({ ok: true, pid: 333 }),
      ...s,
    });
    expect(r.action).toBe("swap");
    expect(s.calls.swap).toBe(1);
    expect(s.calls.boot).toBe(0);
    expect(r.previousVersion).toBe("0.24.7-next.0");
    expect(r.version).toBe("0.24.7-next.1");
    expect(n).toBeGreaterThanOrEqual(3); // the stale next.0 poll did not count as ready
  });

  it("boot is REFUSED when @lydell/node-pty can't load (never start a terminal-less server)", async () => {
    const s = spies();
    await expect(
      ensureServer({
        port: 3847, pkgRoot: "/pkg", packageVersion: PKG_VERSION,
        probeFn: async () => ({ reachable: false, shipwright: false, version: null }),
        ...s,
        nativePtyCheck: async () => ({ ok: false, error: "bindings missing" }),
      }),
    ).rejects.toThrow(/node-pty.*failed to load/);
    expect(s.calls.boot).toBe(0); // never spawned the server
  });

  it("checkNativePty: ok when the module exposes spawn(), not-ok when import throws", async () => {
    expect(await checkNativePty(async () => ({ spawn: () => {} }))).toEqual({ ok: true, error: null });
    const bad = await checkNativePty(async () => {
      throw new Error("Cannot find native binding");
    });
    expect(bad.ok).toBe(false);
    expect(bad.error).toContain("native binding");
  });

  it("AC4 foreign: loud failure with PORT= remediation, incumbent NOT touched", async () => {
    const s = spies();
    await expect(
      ensureServer({
        port: 3847, pkgRoot: "/pkg", packageVersion: PKG_VERSION,
        probeFn: async () => ({ reachable: true, shipwright: false, version: null }),
        ...s,
      }),
    ).rejects.toThrow(/PORT=/);
    expect(s.calls.boot).toBe(0);
    expect(s.calls.swap).toBe(0);
    expect(s.calls.open).toEqual([]); // no browser on a foreign-port failure
  });
});

describe("server — probeServer against a REAL socket (alt ephemeral port, never :3847)", () => {
  function serve(handler) {
    return new Promise((resolve) => {
      const srv = http.createServer(handler);
      srv.listen(0, "127.0.0.1", () => resolve({ srv, port: srv.address().port }));
    });
  }

  const diag = (body) => (req, res) => {
    if (req.url === "/api/diagnostics") {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(body));
    } else {
      res.statusCode = 404;
      res.end();
    }
  };

  it("a Shipwright-shaped /api/diagnostics (name + version) → reachable + shipwright + version", async () => {
    const { srv, port } = await serve(diag({ app: { name: "shipwright-command-center", version: "0.23.0" } }));
    try {
      const p = await probeServer(port);
      expect(p).toEqual({ reachable: true, shipwright: true, version: "0.23.0" });
    } finally {
      srv.close();
    }
  });

  it("a foreign server that answers diagnostics with a WRONG app.name → NOT shipwright", async () => {
    const { srv, port } = await serve(diag({ app: { name: "some-other-tool", version: "9.9.9" } }));
    try {
      const p = await probeServer(port);
      expect(p.reachable).toBe(true);
      expect(p.shipwright).toBe(false); // version alone must never misidentify a stranger
    } finally {
      srv.close();
    }
  });

  it("a foreign server (404 on diagnostics) → reachable but NOT shipwright", async () => {
    const { srv, port } = await serve((_req, res) => {
      res.statusCode = 404;
      res.end("nope");
    });
    try {
      const p = await probeServer(port);
      expect(p.reachable).toBe(true);
      expect(p.shipwright).toBe(false);
    } finally {
      srv.close();
    }
  });

  it("nothing listening → not reachable (free)", async () => {
    // Port 1 is never an HTTP server; connection is refused instantly.
    const p = await probeServer(1, { timeoutMs: 500 });
    expect(p.reachable).toBe(false);
  });

  it("AC4 edge: a raw TCP listener that never speaks HTTP → occupied + FOREIGN (not free)", async () => {
    // The exact case that made a second server boot onto an occupied port:
    // accepts connections, never answers /api/diagnostics.
    const srv = net.createServer(() => {
      /* accept the socket, send nothing — never a valid HTTP response */
    });
    await new Promise((r) => srv.listen(0, "127.0.0.1", r));
    const port = srv.address().port;
    try {
      const p = await probeServer(port, { timeoutMs: 800 });
      expect(p.reachable).toBe(true); // occupied — must NOT be classified free
      expect(p.shipwright).toBe(false); // → decideAction returns "foreign"
    } finally {
      srv.close();
    }
  });
});

describe("server — resolveProbeHost (webui#415: tailscale profile probed on loopback)", () => {
  it("wildcard bind (open profile → 0.0.0.0) maps back down to loopback — still connectable there", async () => {
    const host = await resolveProbeHost("/pkg", {}, async () => ({ resolveHonoHost: () => "0.0.0.0" }));
    expect(host).toBe("127.0.0.1");
  });

  it("wildcard bind (HONO_HOST=true → ::) also maps down to loopback", async () => {
    const host = await resolveProbeHost("/pkg", {}, async () => ({ resolveHonoHost: () => "::" }));
    expect(host).toBe("127.0.0.1");
  });

  it("a concrete bind (tailscale profile's resolved IP) is probed directly, not loopback", async () => {
    const host = await resolveProbeHost("/pkg", {}, async () => ({ resolveHonoHost: () => "100.64.1.2" }));
    expect(host).toBe("100.64.1.2");
  });

  it("an import failure (no staged server/dist, e.g. from source) falls back to loopback, never throws", async () => {
    const host = await resolveProbeHost("/pkg", {}, async () => {
      throw new Error("ENOENT");
    });
    expect(host).toBe("127.0.0.1");
  });

  it("a resolution failure (e.g. `tailscale ip -4` unreachable) falls back to loopback, never throws", async () => {
    const host = await resolveProbeHost("/pkg", {}, async () => ({
      resolveHonoHost: () => {
        throw new Error("[resolveTailscaleIp] tailscale CLI not found on PATH");
      },
    }));
    expect(host).toBe("127.0.0.1");
  });
});

describe("server — resolveProbeHost against the REAL server resolver (webui#415)", () => {
  // Every other resolveProbeHost test injects a fake importFn — none of them
  // exercise the real specifier/export name. A drift there (rename, moved
  // file, changed export) would silently fall through resolveProbeHost's
  // catch and restore the exact pre-fix bug with a fully green mocked suite
  // (code-reviewer finding: `bootstrapper-checks` CI does a bootstrapper-only
  // `npm ci`/test — it never builds server/, and server/dist is gitignored,
  // so a build-gated runtime check alone is ALWAYS skipped in CI and proves
  // nothing there). This SOURCE-level check needs no build and runs in every
  // CI invocation: it asserts the .ts source resolveProbeHost's specifier
  // maps to (server/tsconfig.json: rootDir "./src" -> outDir "./dist", so
  // src/lib/X.ts -> dist/lib/X.js) exists and still exports the function by
  // that exact name.
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const resolverSourcePath = path.join(repoRoot, "server", "src", "lib", "resolveHonoHost.ts");

  it("server/src/lib/resolveHonoHost.ts exists and exports resolveHonoHost — the specifier resolveProbeHost's dist import depends on", () => {
    expect(existsSync(resolverSourcePath)).toBe(true);
    const source = readFileSync(resolverSourcePath, "utf-8");
    expect(source).toMatch(/export function resolveHonoHost\b/);
  });

  it("server/tsconfig.json's rootDir/outDir still map src/lib/X.ts -> dist/lib/X.js — the assumption resolveProbeHost's hardcoded specifier bakes in", () => {
    const tsconfigPath = path.join(repoRoot, "server", "tsconfig.json");
    const tsconfig = JSON.parse(readFileSync(tsconfigPath, "utf-8"));
    expect(tsconfig.compilerOptions.rootDir).toBe("./src");
    expect(tsconfig.compilerOptions.outDir).toBe("./dist");
  });

  it("resolveHonoHost's signature keeps every parameter after `env` optional — resolveProbeHost calls it with only env (doubt review: a name-only check wouldn't catch a future required 2nd param)", () => {
    const source = readFileSync(resolverSourcePath, "utf-8");
    const match = source.match(/export function resolveHonoHost\s*\(([\s\S]*?)\)\s*:/);
    expect(match).not.toBeNull();
    // Depth-aware split: a param's TYPE can itself contain commas (e.g.
    // `Record<string, string | undefined>`), so a naive `.split(",")` would
    // wrongly split THAT comma into a fake extra "parameter".
    const params = [];
    let depth = 0;
    let current = "";
    for (const ch of match[1]) {
      if (ch === "<" || ch === "(" || ch === "[") depth++;
      else if (ch === ">" || ch === ")" || ch === "]") depth--;
      if (ch === "," && depth === 0) {
        params.push(current.trim());
        current = "";
      } else {
        current += ch;
      }
    }
    if (current.trim()) params.push(current.trim());

    expect(params.length).toBeGreaterThanOrEqual(1);
    // First param (env) is required by design. Every param after it MUST
    // carry a default (`= ...`) — if a future refactor makes one required
    // (e.g. dropping `exec`'s default), resolveProbeHost's `resolveHonoHost(env)`
    // call would break at runtime with no build needed to see it here.
    for (const param of params.slice(1)) {
      expect(param).toMatch(/=/);
    }
  });

  // Build-gated bonus: when server/ HAS been built locally (not in CI — see
  // above), also exercise the real compiled output end to end. A runtime
  // conditional test.skip(cond, reason) (first arg not a string) is the
  // documented test-hygiene exemption for a binary/build-artifact gate.
  const builtResolverPath = path.join(repoRoot, "server", "dist", "lib", "resolveHonoHost.js");
  const built = existsSync(builtResolverPath);

  it.skipIf(!built)(
    `resolves the real compiled resolveHonoHost.js for local/open/unset profiles -> loopback${built ? "" : " [skipped: server/ not built locally — run `npm run build` in server/]"}`,
    async () => {
      const local = await resolveProbeHost(repoRoot, { SHIPWRIGHT_NETWORK_PROFILE: "local" });
      const open = await resolveProbeHost(repoRoot, { SHIPWRIGHT_NETWORK_PROFILE: "open" });
      const unset = await resolveProbeHost(repoRoot, {});
      expect(local).toBe("127.0.0.1");
      expect(open).toBe("127.0.0.1");
      expect(unset).toBe("127.0.0.1");
    },
  );
});

describe("server — isSafeProbeHost / formatHostForUrl via resolveProbeHost + probeServer (webui#415 code review)", () => {
  it("rejects an unsafe resolved host (e.g. a shell/cmd metacharacter) and falls back to loopback, calling onFallback", async () => {
    const fallbacks = [];
    const host = await resolveProbeHost(
      "/pkg", {}, async () => ({ resolveHonoHost: () => "%USERPROFILE%" }),
      (reason) => fallbacks.push(reason),
    );
    expect(host).toBe("127.0.0.1");
    expect(fallbacks).toHaveLength(1);
    expect(fallbacks[0]).toMatch(/not a safe/);
  });

  it("accepts a plain hostname (e.g. HONO_HOST=localhost) unchanged", async () => {
    const host = await resolveProbeHost("/pkg", {}, async () => ({ resolveHonoHost: () => "localhost" }));
    expect(host).toBe("localhost");
  });

  it("an import/resolution failure calls onFallback with the error message", async () => {
    const fallbacks = [];
    await resolveProbeHost("/pkg", {}, async () => {
      throw new Error("[resolveTailscaleIp] tailscale CLI not found on PATH");
    }, (reason) => fallbacks.push(reason));
    expect(fallbacks).toEqual(["[resolveTailscaleIp] tailscale CLI not found on PATH"]);
  });

  it("probeServer brackets an IPv6 probe host in the diagnostics fetch URL instead of throwing", async () => {
    let seenUrl = null;
    const p = await probeServer(3847, {
      host: "::1",
      tcpProbe: async () => true,
      fetchImpl: async (url) => {
        seenUrl = url;
        return { ok: true, json: async () => ({ app: { name: "shipwright-command-center", version: "0.23.0" } }) };
      },
    });
    expect(seenUrl).toBe("http://[::1]:3847/api/diagnostics");
    expect(p.shipwright).toBe(true);
  });

  it("ensureServer brackets an IPv6 resolved probe host in the reported/opened url", async () => {
    const calls = [];
    const r = await ensureServer({
      port: 3847, pkgRoot: "/pkg", packageVersion: PKG_VERSION,
      resolveProbeHost: async () => "::1",
      probeFn: async () => ({ reachable: true, shipwright: true, version: "0.23.0" }),
      bootServer: () => 111, spawnSwapper: () => 999, openBrowser: (u) => calls.push(u),
      nativePtyCheck: async () => ({ ok: true, error: null }),
    });
    expect(r.url).toBe("http://[::1]:3847");
    expect(calls).toEqual(["http://[::1]:3847"]);
  });

  it("ensureServer's DEFAULT resolveProbeHost wiring (not overridden) surfaces a fallback reason through `log` (doubt review: this glue line had no assertion coverage)", async () => {
    const logs = [];
    await ensureServer({
      port: 3847, pkgRoot: "/pkg", packageVersion: PKG_VERSION,
      // resolveProbeHost intentionally NOT overridden — exercises ensureServer's
      // own default arrow function, which real-imports pkgRoot/server/dist/...
      // ("/pkg" doesn't exist, so this hits resolveProbeHost's catch-all).
      // shipwright:true + matching version -> "attach": no boot/poll needed.
      probeFn: async () => ({ reachable: true, shipwright: true, version: PKG_VERSION }),
      bootServer: () => 111, spawnSwapper: () => 999, openBrowser: () => {},
      nativePtyCheck: async () => ({ ok: true, error: null }),
      log: (msg) => logs.push(msg),
    });
    expect(logs.some((m) => m.startsWith("probe host resolution fell back to loopback:"))).toBe(true);
  });
});

describe("server — probeServer honours a non-loopback probe host (webui#415)", () => {
  it("threads `host` into BOTH the TCP occupancy probe and the diagnostics fetch URL", async () => {
    const seen = { tcpHost: null, fetchUrl: null };
    const p = await probeServer(3847, {
      host: "100.64.1.2",
      tcpProbe: async (_port, { host }) => {
        seen.tcpHost = host;
        return true;
      },
      fetchImpl: async (url) => {
        seen.fetchUrl = url;
        return { ok: true, json: async () => ({ app: { name: "shipwright-command-center", version: "0.23.0" } }) };
      },
    });
    expect(seen.tcpHost).toBe("100.64.1.2");
    expect(seen.fetchUrl).toBe("http://100.64.1.2:3847/api/diagnostics");
    expect(p).toEqual({ reachable: true, shipwright: true, version: "0.23.0" });
  });

  it("defaults to 127.0.0.1 when no host is given (backward compatible)", async () => {
    const seen = { tcpHost: null };
    await probeServer(3847, {
      tcpProbe: async (_port, { host }) => {
        seen.tcpHost = host;
        return false;
      },
    });
    expect(seen.tcpHost).toBe("127.0.0.1");
  });
});

describe("server — ensureServer reports a url built from the resolved probe host (webui#415)", () => {
  it("a tailscale-resolved host produces a reachable url — not the hardcoded, unreachable localhost", async () => {
    const s = {
      bootServer: () => 111,
      spawnSwapper: () => 999,
      openBrowser: (u) => calls.push(u),
      nativePtyCheck: async () => ({ ok: true, error: null }),
    };
    const calls = [];
    const r = await ensureServer({
      port: 3847, pkgRoot: "/pkg", packageVersion: PKG_VERSION,
      resolveProbeHost: async () => "100.64.1.2",
      probeFn: async () => ({ reachable: true, shipwright: true, version: "0.23.0" }),
      bootServer: s.bootServer, spawnSwapper: s.spawnSwapper, openBrowser: s.openBrowser, nativePtyCheck: s.nativePtyCheck,
    });
    expect(r.url).toBe("http://100.64.1.2:3847");
    expect(calls).toEqual(["http://100.64.1.2:3847"]);
  });

  it("loopback resolution keeps the existing localhost url (unchanged default behaviour)", async () => {
    const calls = [];
    const r = await ensureServer({
      port: 3847, pkgRoot: "/pkg", packageVersion: PKG_VERSION,
      resolveProbeHost: async () => "127.0.0.1",
      probeFn: async () => ({ reachable: true, shipwright: true, version: "0.23.0" }),
      bootServer: () => 111, spawnSwapper: () => 999, openBrowser: (u) => calls.push(u),
      nativePtyCheck: async () => ({ ok: true, error: null }),
    });
    expect(r.url).toBe("http://localhost:3847");
    expect(calls).toEqual(["http://localhost:3847"]);
  });
});

describe("server — openBrowserPlan opens the browser WITHOUT a platform shell", () => {
  const ENV = { ComSpec: "C:\\Windows\\System32\\cmd.exe" };
  const URL = "http://localhost:3847";

  it("win32 invokes the resolved cmd.exe explicitly, never a `shell` option", () => {
    const plan = openBrowserPlan(URL, "win32", ENV);
    expect(plan.command).toBe("C:\\Windows\\System32\\cmd.exe");
    // `start` is a cmd BUILTIN, so cmd.exe is genuinely required — but it is
    // named, not conjured by handing Node a shell command line. The line is
    // built by the shared win32CmdWrap, so it takes the verbatim outer-quoted
    // form (the empty window-title argument alone forces quoting).
    expect(plan.args.slice(0, 3)).toEqual(["/d", "/s", "/c"]);
    expect(plan.args[3]).toBe(`"start "" ${URL}"`);
    expect(plan.windowsVerbatimArguments).toBe(true);
    expect(plan).not.toHaveProperty("shell");
  });

  it("win32 keeps the empty window-TITLE argument `start` needs", () => {
    const plan = openBrowserPlan(URL, "win32", ENV);
    // Without it `start` swallows the URL as the window title and opens nothing.
    // `/s` strips only the OUTER quote pair, so the `""` survives to cmd.
    expect(plan.args[3]).toContain('start "" ');
  });

  it("win32 QUOTES a url carrying a cmd metacharacter", () => {
    // A query string is the everyday case: an unquoted `&` would make cmd run
    // `b=2` as a second command. Exported public API, so it must not rely on the
    // single in-repo caller passing a metachar-free localhost url.
    const plan = openBrowserPlan("http://h/?a=1&b=2", "win32", ENV);
    expect(plan.args[3]).toBe('"start "" "http://h/?a=1&b=2""');
    expect(plan.windowsVerbatimArguments).toBe(true);
  });

  it("win32 percent-encodes a literal quote — the one char quoting cannot contain", () => {
    // A raw `"` would close the quoted region early and let the remainder be
    // read as a command. `"` is never valid unescaped in a URL, so encoding it
    // cannot corrupt a legitimate one.
    const plan = openBrowserPlan('http://h/?a="&calc', "win32", ENV);
    expect(plan.args[3]).not.toContain('a="&calc');
    expect(plan.args[3]).toContain("%22");
  });

  it("win32 honours the environment's ComSpec rather than a hardcoded path", () => {
    const plan = openBrowserPlan(URL, "win32", { ComSpec: "D:\\alt\\cmd.exe" });
    expect(plan.command).toBe("D:\\alt\\cmd.exe");
  });

  it("darwin uses `open`, linux uses `xdg-open`, both bare", () => {
    expect(openBrowserPlan(URL, "darwin", {})).toEqual({ command: "open", args: [URL] });
    expect(openBrowserPlan(URL, "linux", {})).toEqual({ command: "xdg-open", args: [URL] });
  });

  it("no platform branch ever asks for a shell", () => {
    for (const p of ["win32", "darwin", "linux"]) {
      expect(openBrowserPlan(URL, p, ENV)).not.toHaveProperty("shell");
    }
  });

  it("a browser that cannot be launched is NEVER fatal", async () => {
    /*
     * `spawn` reports a launch failure ASYNCHRONOUSLY via the "error" event, so
     * the try/catch inside defaultOpenBrowser cannot see it — and an unhandled
     * "error" on an EventEmitter THROWS, which on a detached+unref'd child would
     * take the whole bootstrapper down. This test is the falsification: remove
     * the `child.on("error", …)` line and this run dies instead of failing
     * politely. Verified by doing exactly that (iterate-2026-07-31).
     */
    const saved = process.env.ComSpec;
    // Force the win32 branch to target a binary that cannot exist. On POSIX the
    // xdg-open/open branch is already an ENOENT for the same reason on CI.
    process.env.ComSpec = "Z:\\definitely\\not\\a\\real\\cmd.exe";
    try {
      expect(() => defaultOpenBrowser("http://localhost:3847")).not.toThrow();
      // Give the "error" event a turn to fire; an unhandled one would abort here.
      await new Promise((r) => setTimeout(r, 250));
    } finally {
      if (saved === undefined) delete process.env.ComSpec;
      else process.env.ComSpec = saved;
    }
  });
});
