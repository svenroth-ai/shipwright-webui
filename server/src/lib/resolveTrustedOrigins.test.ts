import { describe, it, expect } from "vitest";
import { resolveTrustedOrigins } from "./resolveTrustedOrigins.js";

describe("resolveTrustedOrigins — default (loopback-only)", () => {
  const policy = resolveTrustedOrigins({});

  it("mode is 'loopback'", () => {
    expect(policy.mode).toBe("loopback");
  });

  it("accepts http://localhost:5173", () => {
    expect(policy.isAllowed("http://localhost:5173")).toBe(true);
  });

  it("accepts http://127.0.0.1:5173", () => {
    expect(policy.isAllowed("http://127.0.0.1:5173")).toBe(true);
  });

  it("accepts http://[::1]:5173 (IPv6 loopback)", () => {
    expect(policy.isAllowed("http://[::1]:5173")).toBe(true);
  });

  it("rejects Tailscale MagicDNS hostname", () => {
    expect(
      policy.isAllowed("http://pc-dinovo-002.tail4353f0.ts.net:5173"),
    ).toBe(false);
  });

  it("rejects LAN IP", () => {
    expect(policy.isAllowed("http://192.168.10.101:5173")).toBe(false);
  });

  it("rejects null Origin (curl / scripted callers)", () => {
    expect(policy.isAllowed(null)).toBe(false);
  });

  it("rejects empty-string Origin", () => {
    expect(policy.isAllowed("")).toBe(false);
  });

  it("rejects malformed Origin (not a URL)", () => {
    expect(policy.isAllowed("not-a-url")).toBe(false);
  });

  it("rejects substring-attack lookalike (origin host contains 'localhost')", () => {
    expect(policy.isAllowed("http://evil-localhost-attack.com")).toBe(false);
  });

  it("describe() mentions loopback + the widening switches", () => {
    expect(policy.describe()).toMatch(/loopback/);
    expect(policy.describe()).toMatch(/HONO_HOST/);
    expect(policy.describe()).toMatch(/WEBUI_TRUSTED_ORIGINS/);
  });
});

describe("resolveTrustedOrigins — HONO_HOST opt-in (mode='any')", () => {
  function makePolicy(value: string) {
    return resolveTrustedOrigins({ HONO_HOST: value });
  }

  it("mode is 'any' when HONO_HOST=true", () => {
    expect(makePolicy("true").mode).toBe("any");
  });

  it("mode is 'any' for any non-empty HONO_HOST value (literal hostname)", () => {
    expect(makePolicy("pc-dinovo-002.tail4353f0.ts.net").mode).toBe("any");
  });

  it("accepts Tailscale MagicDNS hostname Origin", () => {
    expect(
      makePolicy("true").isAllowed(
        "http://pc-dinovo-002.tail4353f0.ts.net:5173",
      ),
    ).toBe(true);
  });

  it("accepts LAN IP Origin", () => {
    expect(makePolicy("true").isAllowed("http://192.168.10.101:5173")).toBe(
      true,
    );
  });

  it("still accepts loopback origins", () => {
    expect(makePolicy("true").isAllowed("http://localhost:5173")).toBe(true);
  });

  it("rejects null Origin (anonymous scripted caller)", () => {
    expect(makePolicy("true").isAllowed(null)).toBe(false);
  });

  it("rejects empty-string Origin", () => {
    expect(makePolicy("true").isAllowed("")).toBe(false);
  });

  it("describe() echoes the HONO_HOST value back", () => {
    const out = makePolicy("true").describe();
    expect(out).toMatch(/HONO_HOST=true/);
    expect(out).toMatch(/any non-empty Origin/);
  });
});

describe("resolveTrustedOrigins — explicit allowlist (mode='allowlist')", () => {
  it("mode is 'allowlist' when WEBUI_TRUSTED_ORIGINS is set", () => {
    expect(
      resolveTrustedOrigins({
        WEBUI_TRUSTED_ORIGINS: "http://pc-dinovo-002.tail4353f0.ts.net:5173",
      }).mode,
    ).toBe("allowlist");
  });

  it("accepts a single listed origin exactly", () => {
    const p = resolveTrustedOrigins({
      WEBUI_TRUSTED_ORIGINS: "http://pc-dinovo-002.tail4353f0.ts.net:5173",
    });
    expect(p.isAllowed("http://pc-dinovo-002.tail4353f0.ts.net:5173")).toBe(
      true,
    );
  });

  it("rejects a near-miss (different port) when the allowlist is narrow", () => {
    const p = resolveTrustedOrigins({
      WEBUI_TRUSTED_ORIGINS: "http://pc-dinovo-002.tail4353f0.ts.net:5173",
    });
    expect(p.isAllowed("http://pc-dinovo-002.tail4353f0.ts.net:5174")).toBe(
      false,
    );
  });

  it("supports multiple comma-separated entries with whitespace tolerance", () => {
    const p = resolveTrustedOrigins({
      WEBUI_TRUSTED_ORIGINS:
        "http://localhost:5173 , http://192.168.10.101:5173,  http://100.105.29.88:5173",
    });
    expect(p.isAllowed("http://localhost:5173")).toBe(true);
    expect(p.isAllowed("http://192.168.10.101:5173")).toBe(true);
    expect(p.isAllowed("http://100.105.29.88:5173")).toBe(true);
    expect(p.isAllowed("http://10.0.0.1:5173")).toBe(false);
  });

  it("WEBUI_TRUSTED_ORIGINS overrides HONO_HOST permissiveness (narrowest wins)", () => {
    const p = resolveTrustedOrigins({
      HONO_HOST: "true",
      WEBUI_TRUSTED_ORIGINS: "http://localhost:5173",
    });
    expect(p.mode).toBe("allowlist");
    expect(p.isAllowed("http://localhost:5173")).toBe(true);
    expect(p.isAllowed("http://192.168.10.101:5173")).toBe(false);
  });

  it("rejects null Origin even with allowlist set", () => {
    expect(
      resolveTrustedOrigins({
        WEBUI_TRUSTED_ORIGINS: "http://localhost:5173",
      }).isAllowed(null),
    ).toBe(false);
  });

  it("describe() includes the entry count + each entry", () => {
    const out = resolveTrustedOrigins({
      WEBUI_TRUSTED_ORIGINS: "http://a.example,http://b.example",
    }).describe();
    expect(out).toMatch(/2 entries/);
    expect(out).toContain("http://a.example");
    expect(out).toContain("http://b.example");
  });

  it("describe() uses singular 'entry' for a single allowlist item", () => {
    const out = resolveTrustedOrigins({
      WEBUI_TRUSTED_ORIGINS: "http://only.example",
    }).describe();
    expect(out).toMatch(/1 entry/);
  });

  it("empty WEBUI_TRUSTED_ORIGINS string is treated as unset (falls through to default)", () => {
    expect(resolveTrustedOrigins({ WEBUI_TRUSTED_ORIGINS: "" }).mode).toBe(
      "loopback",
    );
  });

  it("WEBUI_TRUSTED_ORIGINS with only whitespace + commas is treated as unset", () => {
    expect(
      resolveTrustedOrigins({ WEBUI_TRUSTED_ORIGINS: "   " }).mode,
    ).toBe("loopback");
  });
});

// ============================================================================
// ADR-083 — SHIPWRIGHT_NETWORK_PROFILE drives the Origin policy
// ============================================================================

import { vi } from "vitest";

const fakeTailscaleExec = (ip = "100.105.29.88") => vi.fn(() => `${ip}\n`);

describe("resolveTrustedOrigins — SHIPWRIGHT_NETWORK_PROFILE=tailscale", () => {
  const policy = resolveTrustedOrigins(
    { SHIPWRIGHT_NETWORK_PROFILE: "tailscale" },
    fakeTailscaleExec("100.105.29.88"),
  );

  it("mode is 'profile-tailscale'", () => {
    expect(policy.mode).toBe("profile-tailscale");
  });

  it("accepts the resolved Tailscale-IPv4 Origin", () => {
    expect(policy.isAllowed("http://100.105.29.88:5173")).toBe(true);
  });

  it("accepts a MagicDNS hostname Origin (the failure that motivated this fix)", () => {
    expect(
      policy.isAllowed("http://pc-dinovo-002.tail4353f0.ts.net:5173"),
    ).toBe(true);
  });

  it("accepts any *.ts.net subdomain (Tailscale MagicDNS namespace)", () => {
    expect(policy.isAllowed("http://phone.tail4353f0.ts.net:5173")).toBe(true);
    expect(policy.isAllowed("https://laptop.tail123abc.ts.net")).toBe(true);
  });

  it("accepts loopback Origin so localhost still works from dev machine", () => {
    expect(policy.isAllowed("http://localhost:5173")).toBe(true);
    expect(policy.isAllowed("http://127.0.0.1:5173")).toBe(true);
  });

  it("rejects a LAN-IP Origin not on the Tailscale interface", () => {
    expect(policy.isAllowed("http://192.168.1.50:5173")).toBe(false);
  });

  it("rejects a different Tailscale-IP than the resolved one", () => {
    expect(policy.isAllowed("http://100.42.42.42:5173")).toBe(false);
  });

  it("rejects an unrelated hostname", () => {
    expect(policy.isAllowed("http://evil.example.com")).toBe(false);
  });

  it("rejects substring lookalike (ts.net.evil.com)", () => {
    expect(policy.isAllowed("http://attacker.ts.net.evil.com")).toBe(false);
  });

  it("rejects empty / null Origin (curl-style)", () => {
    expect(policy.isAllowed(null)).toBe(false);
    expect(policy.isAllowed("")).toBe(false);
  });

  it("rejects garbage Origin strings", () => {
    expect(policy.isAllowed("not-a-url")).toBe(false);
  });

  it("describe() mentions tailscale-IP + *.ts.net", () => {
    expect(policy.describe()).toMatch(/tailscale/);
    expect(policy.describe()).toMatch(/100\.105\.29\.88/);
    expect(policy.describe()).toMatch(/ts\.net/);
  });
});

describe("resolveTrustedOrigins — SHIPWRIGHT_NETWORK_PROFILE=local", () => {
  const policy = resolveTrustedOrigins(
    { SHIPWRIGHT_NETWORK_PROFILE: "local" },
    fakeTailscaleExec(),
  );

  it("mode falls through to 'loopback' (same as default)", () => {
    expect(policy.mode).toBe("loopback");
  });

  it("accepts loopback", () => {
    expect(policy.isAllowed("http://localhost:5173")).toBe(true);
  });

  it("rejects tailscale-IP origins", () => {
    expect(policy.isAllowed("http://100.105.29.88:5173")).toBe(false);
  });

  it("rejects MagicDNS origins", () => {
    expect(
      policy.isAllowed("http://pc-dinovo-002.tail4353f0.ts.net:5173"),
    ).toBe(false);
  });
});

describe("resolveTrustedOrigins — SHIPWRIGHT_NETWORK_PROFILE=open", () => {
  const policy = resolveTrustedOrigins(
    { SHIPWRIGHT_NETWORK_PROFILE: "open" },
    fakeTailscaleExec(),
  );

  it("mode is 'any'", () => {
    expect(policy.mode).toBe("any");
  });

  it("accepts any non-empty Origin (including LAN IPs)", () => {
    expect(policy.isAllowed("http://192.168.1.50:5173")).toBe(true);
    expect(policy.isAllowed("http://localhost:5173")).toBe(true);
    expect(policy.isAllowed("http://pc-dinovo-002.tail4353f0.ts.net:5173")).toBe(true);
  });

  it("still rejects null / empty Origin (curl-style)", () => {
    expect(policy.isAllowed(null)).toBe(false);
    expect(policy.isAllowed("")).toBe(false);
  });
});

describe("resolveTrustedOrigins — precedence: explicit env wins over profile", () => {
  it("WEBUI_TRUSTED_ORIGINS wins over SHIPWRIGHT_NETWORK_PROFILE=tailscale", () => {
    const policy = resolveTrustedOrigins(
      {
        WEBUI_TRUSTED_ORIGINS: "http://only-this.example.com",
        SHIPWRIGHT_NETWORK_PROFILE: "tailscale",
      },
      fakeTailscaleExec(),
    );
    expect(policy.mode).toBe("allowlist");
    expect(policy.isAllowed("http://only-this.example.com")).toBe(true);
    expect(policy.isAllowed("http://100.105.29.88:5173")).toBe(false);
  });

  it("HONO_HOST wins over SHIPWRIGHT_NETWORK_PROFILE=tailscale", () => {
    const policy = resolveTrustedOrigins(
      {
        HONO_HOST: "0.0.0.0",
        SHIPWRIGHT_NETWORK_PROFILE: "tailscale",
      },
      fakeTailscaleExec(),
    );
    expect(policy.mode).toBe("any");
  });

  it("without exec, profile is ignored (fall through to default loopback)", () => {
    const policy = resolveTrustedOrigins({
      SHIPWRIGHT_NETWORK_PROFILE: "tailscale",
    });
    expect(policy.mode).toBe("loopback");
  });

  it("invalid profile does NOT crash the resolver (falls through to default)", () => {
    const policy = resolveTrustedOrigins(
      { SHIPWRIGHT_NETWORK_PROFILE: "everywhere" },
      fakeTailscaleExec(),
    );
    expect(policy.mode).toBe("loopback");
  });
});
