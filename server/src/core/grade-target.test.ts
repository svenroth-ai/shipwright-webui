/*
 * grade-target — target validation + plugin resolution (A09b, FR-01.53).
 *
 * RED on pre-A09b main (the module does not exist), green after. Covers the
 * io-boundary shape/existence gate (an injection boundary — reject bad input
 * with an honest error, never a crash) and the versioned-cache plugin
 * resolution over injected fs seams (no real cache touched).
 */

import { describe, it, expect } from "vitest";
import path from "node:path";

import {
  looksRemote,
  validateGradeTarget,
  resolveGradeScript,
  resolveComplianceRoot,
  ENV_COMPLIANCE_ROOT,
} from "./grade-target.js";

const yes = () => true;
const no = () => false;

describe("looksRemote — server re-derives remote-ness (never trusts the client)", () => {
  it.each([
    ["https://github.com/acme/checkout", true],
    ["http://gitlab.example.com/g/r", true],
    ["github.com/acme/checkout", true],
    ["www.github.com/acme/checkout", true],
    ["git@github.com:acme/checkout.git", true],
    ["ssh://git@host/acme/repo", true],
    ["C:\\work\\api-server", false],
    ["/home/me/repo", false],
    ["./relative/path", false],
  ])("%s → %s", (target, expected) => {
    expect(looksRemote(target)).toBe(expected);
  });
});

describe("validateGradeTarget — honest rejection at the io boundary", () => {
  it("rejects a non-string / empty / whitespace target", () => {
    expect(validateGradeTarget(undefined, yes).ok).toBe(false);
    expect(validateGradeTarget(42, yes).ok).toBe(false);
    expect(validateGradeTarget("", yes).ok).toBe(false);
    expect(validateGradeTarget("   ", yes).ok).toBe(false);
  });

  it("rejects an over-long target and a NUL byte", () => {
    expect(validateGradeTarget("x".repeat(401), yes).ok).toBe(false);
    expect(validateGradeTarget("C:/repo\0/evil", yes).ok).toBe(false);
  });

  it("accepts a plausible remote URL, rejects an implausible one", () => {
    expect(validateGradeTarget("https://github.com/acme/checkout", no)).toMatchObject({
      ok: true,
      kind: "remote",
    });
    expect(validateGradeTarget("github.com/acme/checkout", no)).toMatchObject({
      ok: true,
      kind: "remote",
    });
    expect(validateGradeTarget("git@github.com:acme/checkout.git", no)).toMatchObject({
      ok: true,
      kind: "remote",
    });
    // A scheme with no owner/repo path is not a plausible repo URL.
    const bad = validateGradeTarget("https://github.com", no);
    expect(bad.ok).toBe(false);
    expect(bad.reason).toMatch(/repository URL/i);
  });

  it("accepts a local path only when it resolves to a real directory", () => {
    expect(validateGradeTarget("C:/work/api-server", yes)).toMatchObject({
      ok: true,
      kind: "local",
    });
    const missing = validateGradeTarget("C:/work/api-server", no);
    expect(missing.ok).toBe(false);
    expect(missing.reason).toMatch(/doesn't exist/i);
  });

  it("SSRF guard: rejects loopback / private / link-local / CGNAT remote hosts", () => {
    for (const url of [
      "https://169.254.169.254/a/b", // cloud metadata endpoint (link-local)
      "https://127.0.0.1/a/b",
      "http://localhost/a/b",
      "https://10.0.0.5/a/b",
      "https://192.168.1.9/a/b",
      "https://172.16.0.1/a/b",
      "ssh://git@internal-host:22/a/b", // NOT blocked by name — but IP forms are
      "git://100.64.0.1/a/b", // CGNAT
    ]) {
      const r = validateGradeTarget(url, no);
      if (url.includes("internal-host")) {
        // A bare hostname (not an IP literal) is allowed — grade.py owns the
        // network policy; we only block loopback/private/link-local IP literals.
        expect(r.ok).toBe(true);
      } else {
        expect(r.ok, `${url} must be blocked`).toBe(false);
        expect(r.reason).toMatch(/private or loopback/i);
      }
    }
    // A public host is unaffected.
    expect(validateGradeTarget("https://github.com/acme/checkout", no).ok).toBe(true);
  });

  it("rejects credentials embedded in an http(s) URL (never echo a secret back)", () => {
    const r = validateGradeTarget("https://user:pass@github.com/acme/checkout", no);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/credential/i);
    // The legitimate git@ SSH form (no scheme) is untouched.
    expect(validateGradeTarget("git@github.com:acme/checkout.git", no).ok).toBe(true);
  });

  it("a shell-metachar local path is NOT special-cased — it is just a non-existent dir", () => {
    // shell:false means metachars can't inject; here the honest failure is
    // simply "that folder doesn't exist" (statDir false), never a crash.
    const r = validateGradeTarget("C:/repo; rm -rf /", no);
    expect(r.ok).toBe(false);
  });
});

describe("resolveGradeScript / resolveComplianceRoot — versioned cache layout", () => {
  const homeDir = path.join("/home", "u");
  // <cacheRoot>/shipwright-grade/<version>/scripts/tools/grade.py — built with
  // path.join so keys match the code's platform separator (Windows `\`).
  const cache = path.join(homeDir, ".claude", "plugins", "cache", "shipwright");
  const gradeRoot = path.join(cache, "shipwright-grade");
  const compRoot = path.join(cache, "shipwright-compliance");
  const readdirFn = (p: string): string[] => {
    if (p === gradeRoot) return ["0.9.0", "0.29.1", "README.md"];
    if (p === compRoot) return ["0.2.2"];
    throw new Error(`unexpected readdir ${p}`);
  };
  const gradeScript = path.join(gradeRoot, "0.29.1", "scripts", "tools", "grade.py");
  const complianceRoot = path.join(compRoot, "0.2.2");
  const complianceFile = path.join(complianceRoot, "scripts", "lib", "control_grade.py");
  const existsFn = (p: string): boolean => p === gradeScript || p === complianceFile;

  it("resolves the HIGHEST semver dir that actually carries grade.py", () => {
    // 0.29.1 > 0.9.0 numerically (not lexically) — the compare must be semver-ish.
    expect(resolveGradeScript({ homeDir, existsFn, readdirFn })).toBe(gradeScript);
  });

  it("resolves the compliance PLUGIN ROOT (three dirs up from control_grade.py)", () => {
    expect(resolveComplianceRoot({ homeDir, existsFn, readdirFn })).toBe(complianceRoot);
  });

  it("returns null when the plugin dir is absent", () => {
    expect(
      resolveGradeScript({ homeDir, existsFn: no, readdirFn: () => [] }),
    ).toBeNull();
    expect(
      resolveComplianceRoot({ homeDir, existsFn: no, readdirFn: () => [] }),
    ).toBeNull();
  });

  it("honours an explicit scriptOverride only when the file exists", () => {
    expect(resolveGradeScript({ scriptOverride: "/x/grade.py", existsFn: yes })).toBe("/x/grade.py");
    expect(resolveGradeScript({ scriptOverride: "/x/grade.py", existsFn: no })).toBeNull();
  });

  it("exports the env var grade.py's engine_bridge reads", () => {
    expect(ENV_COMPLIANCE_ROOT).toBe("SHIPWRIGHT_GRADE_COMPLIANCE_ROOT");
  });
});
