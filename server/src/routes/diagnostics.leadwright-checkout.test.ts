/*
 * diagnostics.leadwright-checkout.test.ts —
 * iterate-2026-09-07-leadwright-setup-wizard (W14), external-review
 * addition (GLM architecture pass): surface `leadwrightCheckoutRoot`
 * config-pointer presence on `/api/diagnostics` — the page an operator
 * already checks for server health — so a rotted/unset checkout is
 * visible OUTSIDE the wizard, not only discovered mid-session as an
 * in-wizard "not reachable" state. Config-pointer presence only, never a
 * live spawn probe on every health poll.
 */
import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { createDiagnosticsRoutes } from "./diagnostics.js";
import type { SdkSessionsStore } from "../core/sdk-sessions-store.js";

function fakeStore(): SdkSessionsStore {
  return { list: () => [], get: () => undefined } as unknown as SdkSessionsStore;
}

function fakeVersionInfo() {
  return { raw: "2.1.132 (Claude Code)", parsed: { major: 2, minor: 1, patch: 132 }, supported: true };
}

async function probeOrg(leadwrightCheckoutRoot: string | undefined): Promise<{ org: { leadwrightCheckout: string } }> {
  const app = new Hono();
  app.route(
    "/",
    createDiagnosticsRoutes({ store: fakeStore(), versionInfo: fakeVersionInfo, leadwrightCheckoutRoot }),
  );
  const res = await app.request("/api/diagnostics");
  return res.json() as never;
}

describe("GET /api/diagnostics — org.leadwrightCheckout", () => {
  it('reports "unconfigured" when leadwrightCheckoutRoot is unset', async () => {
    const json = await probeOrg(undefined);
    expect(json.org).toEqual({ leadwrightCheckout: "unconfigured" });
  });

  it('reports "configured" when leadwrightCheckoutRoot is set (no live spawn probe)', async () => {
    const json = await probeOrg("/some/leadwright/checkout");
    expect(json.org).toEqual({ leadwrightCheckout: "configured" });
  });
});
