import { describe, it, expect } from "vitest";
import http from "node:http";
import net from "node:net";

import {
  probeServer,
  decideAction,
  ensureServer,
  bootSpawnPlan,
  swapperSpawnPlan,
  checkNativePty,
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
