import { describe, it, expect } from "vitest";
import {
  parseManifest,
  resolveMarketplacePlugins,
  buildInstalledMap,
  ensurePlugins,
  mapsEqual,
} from "../lib/plugins.mjs";

/** Build a manifest JSON string with N synthetic plugins. */
function manifest(names) {
  return JSON.stringify({
    name: "shipwright",
    version: "0.31.0",
    plugins: names.map((n) => ({ name: n, source: `./plugins/${n}`, version: "0.31.0" })),
  });
}

const FOURTEEN = Array.from({ length: 14 }, (_, i) => `plugin-${String(i + 1).padStart(2, "0")}`);
const FIFTEEN = [...FOURTEEN, "plugin-15"];

describe("plugins — parseManifest defensive validation (cross-repo published contract)", () => {
  it("parses a well-formed manifest in order", () => {
    expect(parseManifest(manifest(FOURTEEN), "fixture")).toEqual(FOURTEEN);
  });

  it("a 15-plugin manifest yields 15 names — with ZERO code change", () => {
    expect(parseManifest(manifest(FIFTEEN), "fixture")).toHaveLength(15);
  });

  it("non-JSON → hard error naming the source", () => {
    expect(() => parseManifest("{not json", "https://x/marketplace.json")).toThrow(/https:\/\/x\/marketplace.json/);
  });

  it("no plugins[] array → hard error, never a silent empty list", () => {
    expect(() => parseManifest(JSON.stringify({ name: "x" }), "P")).toThrow(/no plugins\[\] array/);
  });

  it("an entry with no valid name → hard error", () => {
    const bad = JSON.stringify({ plugins: [{ name: "ok" }, { source: "./x" }] });
    expect(() => parseManifest(bad, "P")).toThrow(/no valid "name"/);
  });

  it("a name with whitespace / shell metacharacters → hard error (installer-safety)", () => {
    const bad = JSON.stringify({ plugins: [{ name: "evil; rm -rf" }] });
    expect(() => parseManifest(bad, "P")).toThrow(/invalid plugin name/);
  });

  it("duplicate names → hard error (never install one twice)", () => {
    const dup = JSON.stringify({ plugins: [{ name: "plugin-01" }, { name: "plugin-01" }] });
    expect(() => parseManifest(dup, "P")).toThrow(/duplicate plugin name/);
  });
});

describe("plugins — AC3: resolver precedence (local → remote → override)", () => {
  const seams = (over) => ({
    readLocalManifest: over.local ?? (() => null),
    fetchRemoteManifest: over.remote ?? (async () => null),
    readOverrideManifest: over.override ?? (() => null),
  });

  it("local cache wins when present", async () => {
    const r = await resolveMarketplacePlugins(
      seams({ local: () => ({ text: manifest(FOURTEEN), source: "local" }) }),
    );
    expect(r.source).toBe("local");
    expect(r.names).toHaveLength(14);
  });

  it("falls to GitHub raw when local absent", async () => {
    const r = await resolveMarketplacePlugins(
      seams({ remote: async () => ({ text: manifest(FOURTEEN), source: "gh" }) }),
    );
    expect(r.source).toBe("gh");
  });

  it("SHIPWRIGHT_MARKETPLACE_MANIFEST override (test seam) → a 15th plugin installs, no code change", async () => {
    const r = await resolveMarketplacePlugins(
      seams({ override: () => ({ text: manifest(FIFTEEN), source: "/tmp/fixture.json" }) }),
    );
    expect(r.names).toHaveLength(15);
    expect(r.names).toContain("plugin-15");
  });

  it("NOTHING resolves → loud abort, NEVER a hardcoded fallback", async () => {
    await expect(resolveMarketplacePlugins(seams({}))).rejects.toThrow(/refusing to fall back to a hardcoded list/);
  });
});

describe("plugins — buildInstalledMap", () => {
  it("keys by bare name, values are the first entry's version", () => {
    const m = buildInstalledMap({
      plugins: {
        "plugin-01@shipwright": [{ version: "0.31.0", installPath: "/x" }],
        "plugin-02@shipwright": [{ version: "0.30.0" }],
      },
    });
    expect(m).toEqual({ "plugin-01": "0.31.0", "plugin-02": "0.30.0" });
  });
});

describe("plugins — AC1/AC2/AC5: install vs update + changed-set", () => {
  function recorder(marketplaceOk = true) {
    const calls = [];
    const runClaude = (args) => {
      calls.push(args);
      if (args[1] === "marketplace" && args[2] === "add" && !marketplaceOk) {
        return { ok: false, code: 1, stdout: "", stderr: "marketplace already exists" };
      }
      return { ok: true, code: 0, stdout: "", stderr: "" };
    };
    return { calls, runClaude };
  }

  it("AC1 fresh machine: marketplace ADD + N× plugin INSTALL (exact sequence)", async () => {
    const { calls, runClaude } = recorder(true);
    const out = await ensurePlugins({
      runClaude,
      resolvePlugins: async () => ({ names: FOURTEEN, source: "local" }),
      snapshotInstalled: () => ({}), // nothing installed before → every plugin is an INSTALL
    });
    expect(calls[0]).toEqual(["plugin", "marketplace", "add", "svenroth-ai/shipwright"]);
    const installs = calls.filter((c) => c[1] === "install");
    expect(installs).toHaveLength(14);
    expect(installs[0]).toEqual(["plugin", "install", "plugin-01@shipwright"]);
    expect(calls.filter((c) => c[1] === "update" && c[2]?.endsWith?.("@shipwright"))).toHaveLength(0);
    expect(out.marketplaceAction).toBe("add");
  });

  it("AC1 changed-set: before≠after → pluginsChanged true", async () => {
    const { runClaude } = recorder(true);
    const snaps = [{}, Object.fromEntries(FOURTEEN.map((n) => [n, "0.31.0"]))];
    let i = 0;
    const out = await ensurePlugins({
      runClaude,
      resolvePlugins: async () => ({ names: FOURTEEN, source: "local" }),
      snapshotInstalled: () => snaps[Math.min(i++, 1)],
    });
    expect(out.pluginsChanged).toBe(true);
  });

  it("AC2 rerun: marketplace UPDATE + N× plugin UPDATE, no change → pluginsChanged false", async () => {
    const { calls, runClaude } = recorder(false); // add reports "already exists"
    const installed = Object.fromEntries(FOURTEEN.map((n) => [n, "0.31.0"]));
    const out = await ensurePlugins({
      runClaude,
      resolvePlugins: async () => ({ names: FOURTEEN, source: "local" }),
      snapshotInstalled: () => ({ ...installed }), // identical before & after
    });
    expect(calls).toContainEqual(["plugin", "marketplace", "update", "shipwright"]);
    expect(calls.filter((c) => c[1] === "update" && c[2]?.endsWith?.("@shipwright"))).toHaveLength(14);
    expect(calls.filter((c) => c[1] === "install")).toHaveLength(0);
    expect(out.marketplaceAction).toBe("update");
    expect(out.pluginsChanged).toBe(false); // AC5: nothing moved → no restart notice
  });

  it("changed-set is order-independent (map key order is not a signal)", () => {
    expect(mapsEqual({ a: "1", b: "2" }, { b: "2", a: "1" })).toBe(true);
    expect(mapsEqual({ a: "1" }, { a: "2" })).toBe(false);
    expect(mapsEqual({ a: "1" }, { a: "1", b: "2" })).toBe(false);
  });

  it("a marketplace add failure (not 'already exists') is recorded, not swallowed", async () => {
    const runClaude = (args) =>
      args[2] === "add"
        ? { ok: false, code: 1, stdout: "", stderr: "network unreachable" }
        : { ok: true, code: 0, stdout: "", stderr: "" };
    const out = await ensurePlugins({
      runClaude,
      resolvePlugins: async () => ({ names: FOURTEEN, source: "gh" }),
      snapshotInstalled: () => ({}),
    });
    expect(out.marketplaceOk).toBe(false); // surfaced, not hidden
  });

  it("AC8 honesty: a plugin exiting non-zero is recorded as a failure, others continue", async () => {
    const runClaude = (args) => {
      if (args[1] === "install" && args[2] === "plugin-03@shipwright") return { ok: false, code: 7, stdout: "", stderr: "boom" };
      return { ok: true, code: 0, stdout: "", stderr: "" };
    };
    const out = await ensurePlugins({
      runClaude,
      resolvePlugins: async () => ({ names: FOURTEEN, source: "local" }),
      snapshotInstalled: () => ({}),
    });
    expect(out.failures).toHaveLength(1);
    expect(out.failures[0].name).toBe("plugin-03");
    expect(out.results).toHaveLength(14); // all attempted
  });
});
