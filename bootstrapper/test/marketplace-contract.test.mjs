/**
 * marketplace-contract.test.mjs — the CONSUMER-DRIVEN contract with the monorepo.
 * THE LIVE HALF. Its deterministic twin is marketplace-contract-offline.test.mjs;
 * the shared mechanism lives in test/helpers/manifest-probe.mjs.
 *
 * WHAT WAS MISSING. `bin/shipwright.mjs` installs whatever
 * `.claude-plugin/marketplace.json` in svenroth-ai/shipwright says, fetched over
 * plain HTTPS and parsed by `parseManifest()`. Every other test of that parser
 * feeds SYNTHETIC fixtures, so the parser was well covered and the CONTRACT was
 * not covered at all: if the monorepo changes the manifest's shape, `npx
 * @svenroth-ai/shipwright` breaks for every user, and neither repo's CI notices.
 * This file is the only thing in either repo that reads the real document.
 *
 * WHY NOT A CHECKED-IN FIXTURE COPY. Deliberately rejected: a committed copy of
 * the manifest looks like coverage, ages silently, and stays green exactly when
 * users are broken. The live document is the only honest source. The cost is a
 * network dependency, and that cost is paid explicitly by the skip rule.
 *
 * WHY IT ASSERTS NO PLUGIN COUNT AND NO PLUGIN NAME. `lib/plugins.mjs` exists to
 * NEVER hardcode a plugin list ("the manifest is the SSoT" — its header), and
 * the shipped bootstrapper names zero plugins anywhere. Asserting "14 plugins"
 * or "must contain shipwright-iterate" would re-introduce exactly the coupling
 * that module was written to avoid, and would go red the day a 15th plugin
 * legitimately lands. The contract IS `parseManifest`'s shape rule, no more.
 *
 * THE SKIP RULE. See test/helpers/network-verdict.mjs — "could not ask" skips
 * loudly, "asked and got a bad answer" fails. Its decision table, and the probe
 * wiring that routes outcomes into it, are covered offline and deterministically
 * by the twin file, so everything except the live read stays under test on the
 * days this probe cannot run. ONE EXCEPTION: on the weekly scheduled run a skip
 * FAILS, because there a green run nobody is notified about is indistinguishable
 * from a verified one (`verificationIsMandatory`).
 *
 * WHAT THIS DOES NOT COVER, stated so the guarantee is not read too widely:
 *  - `resolveMarketplacePlugins` tries a LOCAL marketplace clone FIRST
 *    (plugins.mjs:79-93); the raw URL is precedence 2. So this probes the path a
 *    FIRST-RUN npx takes, and the fallback any run may take — not the cached
 *    clone a returning user usually parses.
 *  - `npx @svenroth-ai/shipwright` without `@latest` runs a cached tarball whose
 *    baked-in MANIFEST_RAW_URL is whatever shipped in that version. This
 *    certifies the constant at THIS head, not the one users are executing.
 *  - The `shared/` tree that `cache-runtime.mjs` copies is separate cross-repo
 *    surface with no probe of its own.
 */

import { describe, it, expect } from "vitest";
import { MANIFEST_RAW_URL } from "../lib/plugins.mjs";
import { makeFetchRemoteManifest } from "../lib/claude-cli.mjs";
import {
  reportInconsistentEndpoint,
  reportUnverified,
  verificationIsMandatory,
} from "./helpers/network-verdict.mjs";
import { assertManifestContract, CONTRACT_TITLE, probeManifest } from "./helpers/manifest-probe.mjs";

describe("marketplace contract — the LIVE monorepo manifest", () => {
  it("the published manifest is accepted by the installer's own parser", async (ctx) => {
    const probe = await probeManifest();

    if (probe.verdict === "skip") {
      const message = reportUnverified({ title: CONTRACT_TITLE, reason: probe.reason });
      // On the WEEKLY run a skip would be an unnotified green — see
      // `verificationIsMandatory` for why that is the one case where "could not
      // check" has to fail instead. On a PR it stays a skip: a GitHub outage
      // must never block a contributor.
      if (verificationIsMandatory()) {
        throw new Error(
          `${message}\nThis run REQUIRES verification (scheduled run, or ` +
            `SHIPWRIGHT_REQUIRE_MANIFEST_VERIFICATION set), so an unverifiable ` +
            `manifest fails rather than skipping. Re-run the job once GitHub is reachable.`,
        );
      }
      ctx.skip(message);
      return;
    }

    expect(
      probe.verdict,
      `${MANIFEST_RAW_URL} answered but the answer is unusable — ${probe.reason}`,
    ).toBe("check");

    // A retry that rescued a fail-classified first read is announced, never
    // swallowed: the run stays green because the document below is checked in
    // full, but the producer's inconsistency is on the record.
    if (probe.recoveredFrom) {
      reportInconsistentEndpoint({ title: CONTRACT_TITLE, firstReason: probe.recoveredFrom });
    }

    await assertManifestContract(probe.text, MANIFEST_RAW_URL);
  });
});

describe("marketplace contract — the installer's default target (offline)", () => {
  it("the seam fetches MANIFEST_RAW_URL when no url is injected", async () => {
    // The URL is the contract's other half: parsing the right document is
    // worthless if production reaches for a different one. Asserted with the
    // default argument left alone, which the injected-url path cannot do.
    const requested = [];
    const fetchImpl = async (url) => {
      requested.push(url);
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ plugins: [{ name: "a" }] }),
      };
    };
    await makeFetchRemoteManifest({ fetchImpl })();
    expect(requested).toEqual([MANIFEST_RAW_URL]);
  });

  it("MANIFEST_RAW_URL still points at the monorepo's manifest path", () => {
    expect(MANIFEST_RAW_URL).toBe(
      "https://raw.githubusercontent.com/svenroth-ai/shipwright/main/.claude-plugin/marketplace.json",
    );
  });
});
