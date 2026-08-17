import { describe, expect, it } from "vitest";
import path from "node:path";
import os from "node:os";

import {
  isAllowedOrgRouteHost,
  checkOrgSecret,
  resolveOrgAllowlistedTarget,
  ORG_ALLOWLIST_LITERALS,
  LEADS_USAGE_REFRESH_INTERVAL_MS,
} from "../_helpers.js";

describe("isAllowedOrgRouteHost", () => {
  it("allows IPv4 loopback (127.0.0.1 and other 127.0.0.0/8 addresses)", () => {
    expect(isAllowedOrgRouteHost("127.0.0.1")).toBe(true);
    expect(isAllowedOrgRouteHost("127.1.2.3")).toBe(true);
  });

  it("allows IPv6 loopback (::1)", () => {
    expect(isAllowedOrgRouteHost("::1")).toBe(true);
  });

  it("allows Tailscale CGNAT range 100.64.0.0/10", () => {
    expect(isAllowedOrgRouteHost("100.64.0.0")).toBe(true);
    expect(isAllowedOrgRouteHost("100.100.50.50")).toBe(true);
    expect(isAllowedOrgRouteHost("100.127.255.255")).toBe(true);
  });

  it("denies addresses just outside the Tailscale range", () => {
    expect(isAllowedOrgRouteHost("100.63.255.255")).toBe(false);
    expect(isAllowedOrgRouteHost("100.128.0.0")).toBe(false);
  });

  it("denies the wide-open bind values (allowlist, not a denylist)", () => {
    expect(isAllowedOrgRouteHost("0.0.0.0")).toBe(false);
    expect(isAllowedOrgRouteHost("::")).toBe(false);
  });

  it("denies an arbitrary non-loopback, non-Tailscale IPv4 address", () => {
    expect(isAllowedOrgRouteHost("192.168.1.5")).toBe(false);
  });

  it("denies a non-IP hostname", () => {
    expect(isAllowedOrgRouteHost("example.com")).toBe(false);
  });
});

describe("checkOrgSecret", () => {
  it("returns not_configured when the server has no secret set", () => {
    expect(checkOrgSecret(undefined, "anything")).toBe("not_configured");
    expect(checkOrgSecret("", "anything")).toBe("not_configured");
  });

  it("returns invalid when the header is missing", () => {
    expect(checkOrgSecret("s3cr3t", undefined)).toBe("invalid");
    expect(checkOrgSecret("s3cr3t", null)).toBe("invalid");
    expect(checkOrgSecret("s3cr3t", "")).toBe("invalid");
  });

  it("returns invalid on a mismatched secret", () => {
    expect(checkOrgSecret("s3cr3t", "wrong")).toBe("invalid");
  });

  it("returns invalid on a same-length mismatched secret (no length leak shortcut)", () => {
    expect(checkOrgSecret("abcdef", "abcdeg")).toBe("invalid");
  });

  it("returns ok on an exact match", () => {
    expect(checkOrgSecret("s3cr3t", "s3cr3t")).toBe("ok");
  });
});

describe("resolveOrgAllowlistedTarget", () => {
  const root = path.join(os.tmpdir(), "org-route-leads-test-fixture");

  it("counts off exactly six allowed target kinds (five literals + charter pattern)", () => {
    expect(ORG_ALLOWLIST_LITERALS.length).toBe(5);
    const kinds = new Set(ORG_ALLOWLIST_LITERALS.map((l) => l.kind));
    kinds.add("charter");
    expect(kinds.size).toBe(6);
  });

  it("includes AGENTS.md in the literal allowlist", () => {
    expect(ORG_ALLOWLIST_LITERALS.some((l) => l.path === "AGENTS.md")).toBe(true);
  });

  it.each(ORG_ALLOWLIST_LITERALS)("resolves literal target $path", ({ path: p, kind }) => {
    const result = resolveOrgAllowlistedTarget(root, p);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.kind).toBe(kind);
      expect(result.absolute).toBe(path.join(root, p));
    }
  });

  it("resolves a per-lead charter.md", () => {
    const result = resolveOrgAllowlistedTarget(root, "acme-lead/charter.md");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.kind).toBe("charter");
  });

  it("rejects a charter path with an invalid lead-id", () => {
    const result = resolveOrgAllowlistedTarget(root, "ACME_LEAD/charter.md");
    expect(result).toEqual({ ok: false, reason: "not_allowlisted" });
  });

  it("rejects org-chart.json (readable, not writable through this allowlist)", () => {
    const result = resolveOrgAllowlistedTarget(root, "org-chart.json");
    expect(result).toEqual({ ok: false, reason: "not_allowlisted" });
  });

  it("rejects a file outside the allowlist", () => {
    const result = resolveOrgAllowlistedTarget(root, "random-notes.md");
    expect(result).toEqual({ ok: false, reason: "not_allowlisted" });
  });

  it("rejects traversal via ..", () => {
    const result = resolveOrgAllowlistedTarget(root, "../decision_log.md");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("traversal");
  });

  it("rejects an absolute path", () => {
    const result = resolveOrgAllowlistedTarget(root, path.join(os.tmpdir(), "decision_log.md"));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("absolute_input");
  });

  it("rejects nested traversal inside a charter-shaped path", () => {
    const result = resolveOrgAllowlistedTarget(root, "acme-lead/../../decision_log.md");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("traversal");
  });
});

describe("LEADS_USAGE_REFRESH_INTERVAL_MS", () => {
  it("is a positive, named constant (5 minutes)", () => {
    expect(LEADS_USAGE_REFRESH_INTERVAL_MS).toBe(5 * 60 * 1000);
  });
});
