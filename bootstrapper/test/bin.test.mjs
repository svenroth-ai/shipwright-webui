import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseArgs, validateArgs, resolvePort, printSummary, main } from "../bin/shipwright.mjs";

const SELF = JSON.parse(
  readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "package.json"), "utf-8"),
).version;

function capture() {
  const lines = [];
  return { log: (m) => lines.push(String(m)), text: () => lines.join("\n") };
}

describe("bin — parseArgs", () => {
  it("parses every flag", () => {
    const a = parseArgs(["--no-open", "--plugins-only", "--port", "4000"]);
    expect(a.noOpen).toBe(true);
    expect(a.pluginsOnly).toBe(true);
    expect(a.port).toBe(4000);
  });
  it("--port=NNNN inline form", () => {
    expect(parseArgs(["--port=5555"]).port).toBe(5555);
  });

  it("resolvePort: --port wins, else PORT env, else 3847", () => {
    expect(resolvePort(parseArgs(["--port=5000"]), {})).toBe(5000);
    expect(resolvePort(parseArgs([]), { PORT: "4000" })).toBe(4000);
    expect(resolvePort(parseArgs([]), {})).toBe(3847);
    expect(Number.isNaN(resolvePort(parseArgs([]), { PORT: "abc" }))).toBe(true);
  });

  it("validateArgs rejects contradictory flags + out-of-range ports (--port OR PORT env)", () => {
    expect(validateArgs(parseArgs(["--plugins-only", "--webui-only"]), 3847)).toMatch(/mutually exclusive/);
    expect(validateArgs(parseArgs([]), 0)).toMatch(/invalid port/);
    expect(validateArgs(parseArgs([]), 70000)).toMatch(/invalid port/);
    expect(validateArgs(parseArgs([]), NaN)).toMatch(/invalid port/); // PORT=abc
    expect(validateArgs(parseArgs([]), 3847)).toBeNull();
  });

  it("main returns 2 on contradictory flags, before any mutation", async () => {
    const c = capture();
    const code = await main(["--plugins-only", "--webui-only"], c.log);
    expect(code).toBe(2);
    expect(c.text()).toMatch(/mutually exclusive/);
  });
});

describe("bin — --version / --help never touch network, claude, or :3847", () => {
  it("--version prints the package version and exits 0", async () => {
    const c = capture();
    const code = await main(["--version"], c.log);
    expect(code).toBe(0);
    expect(c.text().trim()).toBe(SELF);
  });
  it("--help prints usage and exits 0", async () => {
    const c = capture();
    const code = await main(["--help"], c.log);
    expect(code).toBe(0);
    expect(c.text()).toContain("npx @svenroth-ai/shipwright@latest");
  });
});

describe("bin — AC5/AC8: restart notice prints EXACTLY when plugins changed", () => {
  const outcome = (pluginsChanged, results = [], failures = []) => ({
    skipped: false,
    cacheOk: true,
    outcome: { results, failures, pluginsChanged },
  });

  it("plugins changed → 'Restart Claude Code' prints", () => {
    const c = capture();
    printSummary(c.log, {
      plugin: outcome(true, [{ action: "install", ok: true, name: "plugin-01" }]),
      server: { action: "attach", url: "http://localhost:3847" },
    });
    expect(c.text()).toContain("Restart Claude Code");
    expect(c.text()).toContain("Installed: plugin-01");
  });

  it("nothing changed → 'Restart Claude Code' does NOT print", () => {
    const c = capture();
    printSummary(c.log, {
      plugin: outcome(false, [{ action: "update", ok: true, name: "plugin-01" }]),
      server: { action: "attach", url: "http://localhost:3847" },
    });
    expect(c.text()).not.toContain("Restart Claude Code");
  });

  it("AC8 honesty: a non-zero plugin is reported as FAILED, not silently ✔", () => {
    const c = capture();
    printSummary(c.log, {
      plugin: outcome(true, [{ action: "install", ok: false, name: "plugin-03" }], [{ name: "plugin-03", code: 7 }]),
      server: { action: "boot", url: "http://localhost:3847" },
    });
    expect(c.text()).toContain("FAILED:    plugin-03@shipwright (exit 7)");
  });

  it("swap summary reports the new version", () => {
    const c = capture();
    printSummary(c.log, {
      plugin: outcome(false),
      server: { action: "swap", url: "http://localhost:3847", version: "0.23.0" },
    });
    expect(c.text()).toContain("updated to 0.23.0");
  });
});
