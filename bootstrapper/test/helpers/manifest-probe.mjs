/**
 * manifest-probe.mjs — reading the marketplace manifest, and holding it to the
 * contract. Split out of `marketplace-contract.test.mjs` when that file crossed
 * the repo's 300-line cap (CLAUDE.md Conventions); the seam is the natural one —
 * this is the MECHANISM, the two `.test.mjs` files are the CASES.
 *
 * Deliberately a helper and not a second `.test.mjs`: importing one test file
 * from another re-registers its `describe` blocks, which would fire the live
 * network read twice per run.
 *
 * TEST-ONLY — `package.json#files` publishes `lib/`, not `test/`, so nothing
 * here ships to an `npx @svenroth-ai/shipwright` user. Note also that
 * `tsconfig.json` excludes `test`, so the job's `npx tsc --noEmit` step does NOT
 * type-check this file; its correctness rests on the offline suites.
 */

import { expect } from "vitest";
import { MANIFEST_RAW_URL, parseManifest } from "../../lib/plugins.mjs";
import { makeFetchRemoteManifest } from "../../lib/claude-cli.mjs";
import { classifyFetchOutcome } from "./network-verdict.mjs";

/**
 * Deadline for ONE attempt (request AND body). Deliberately MORE forgiving than
 * production, which allows 4s (`claude-cli.mjs` makeFetchRemoteManifest); a
 * manifest that needs 8s therefore passes here and would time out for a real
 * user's fallback fetch. That gap is accepted: this probe answers "is the
 * document still the right shape", not "is the CDN fast enough today", and a
 * tighter deadline would only add flake to every PR. Both attempts still finish
 * well inside vitest's 20s testTimeout.
 */
export const PROBE_TIMEOUT_MS = 8_000;

/** Backoff before the single retry. */
const RETRY_DELAY_MS = 1_000;

/** Title used on every "could not verify" notice. */
export const CONTRACT_TITLE = "marketplace manifest contract";

/** The marketplace ID. See assertManifestContract for why this is load-bearing. */
const MARKETPLACE_ID = "shipwright";

/**
 * Read the manifest once, classifying the outcome as skip / check / fail.
 *
 * The two try blocks are minimal ON PURPOSE: only the request and the body read
 * may contribute a `transportError`. Anything after — JSON parsing, contract
 * assertions — is outside, so a coding defect can never disguise itself as a
 * transport failure and skip the build green.
 *
 * @param {{ fetchImpl?: typeof fetch, url?: string, timeoutMs?: number }} deps
 * @returns {Promise<{verdict: string, reason: string, text?: string}>}
 */
export async function probeManifest(deps = {}) {
  const { sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = deps;

  // ONE retry, and only for a `fail`-classified STATUS (Stage-3 doubt review).
  // Real drift is persistent and survives a retry; a CDN edge serving a stale
  // 404, or Fastly abuse-protection answering 403, does not. Without this, a
  // single blip reds an unrelated contributor's PR — and blocks it outright once
  // the job is armed. Deliberately NOT retried on `skip` (already harmless) or
  // on `check` (we have our answer).
  const first = await probeManifestOnce(deps);
  if (first.verdict !== "fail") return first;
  await sleep(deps.retryDelayMs ?? RETRY_DELAY_MS);
  const second = await probeManifestOnce(deps);
  if (second.verdict === "fail") {
    return { ...second, reason: `${second.reason} (confirmed on a second attempt)` };
  }
  // A disagreement between two reads is NOT silently forgiven — the caller
  // announces it (see AC5 in the iterate spec, amended for exactly this case).
  // The document from the second read is still held to the full contract, so
  // real drift, which is persistent, still fails on both attempts.
  return { ...second, recoveredFrom: first.reason };
}

/** One attempt. See probeManifest for the retry policy. */
export async function probeManifestOnce(deps = {}) {
  const {
    fetchImpl = (...args) => fetch(...args),
    url = MANIFEST_RAW_URL,
    timeoutMs = PROBE_TIMEOUT_MS,
  } = deps;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response;
    try {
      response = await fetchImpl(url, { signal: controller.signal });
    } catch (error) {
      return classifyFetchOutcome({ transportError: error });
    }

    const verdict = classifyFetchOutcome({ status: response.status });
    if (verdict.verdict !== "check") return verdict;

    let text;
    try {
      text = await response.text();
    } catch (error) {
      // A body that starts and then dies is still "no complete answer arrived".
      return classifyFetchOutcome({ transportError: error });
    }
    return { ...verdict, text };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Hold a retrieved manifest to the contract. THROWS on any violation — this is
 * the "received but non-conforming MUST be red" half of the rule.
 * @returns {Promise<string[]>} the plugin names the installer would act on
 */
export async function assertManifestContract(text, url) {
  // parseManifest throws a source-naming error on every shape it refuses, so a
  // failure here reads as the actual drift rather than as "undefined".
  const names = parseManifest(text, url);
  expect(Array.isArray(names)).toBe(true);
  expect(names.length).toBeGreaterThan(0);

  // TWO FIELDS parseManifest NEVER READS, both of which break every user while
  // the document parses perfectly (Stage-3 doubt review). Neither hardcodes a
  // plugin list, so neither reopens the coupling lib/plugins.mjs avoids, and
  // neither goes red on a legitimate 15th plugin.
  //
  //  1. The top-level `name` IS the marketplace ID, and the installer hardcodes
  //     it at four sites: `marketplace update shipwright` (plugins.mjs:142),
  //     `plugin install <name>@shipwright` (:161), and the two cache paths in
  //     claude-cli.mjs (:99, :103). Rename it upstream and every install fails
  //     against an unknown marketplace.
  //  2. `plugins[].source` is what `claude plugin install` resolves. A monorepo
  //     restructure that leaves every source dangling breaks every install.
  const parsed = JSON.parse(text);
  expect(
    parsed.name,
    `the marketplace ID is hardcoded in four places in lib/; ${url} must keep it`,
  ).toBe(MARKETPLACE_ID);
  const sourceless = parsed.plugins.filter((p) => typeof p?.source !== "string" || !p.source.trim());
  expect(sourceless.map((p) => p?.name), "every plugin entry needs an installable source").toEqual(
    [],
  );

  // The production seam, driven over the SAME captured bytes (no second fetch).
  // This pins what a direct parseManifest call cannot: that the seam's own
  // ok-check and body handling still yield the IDENTICAL list the installer
  // acts on. Note `url` is injected here, so this proves the seam honours its
  // injection point — that its DEFAULT is MANIFEST_RAW_URL is a separate claim,
  // pinned by its own case in marketplace-contract.test.mjs.
  const requested = [];
  const fetchImpl = async (requestedUrl) => {
    requested.push(requestedUrl);
    return { ok: true, status: 200, text: async () => text };
  };
  const resolved = await makeFetchRemoteManifest({ fetchImpl, url })();
  expect(requested).toEqual([url]);
  expect(resolved).not.toBeNull();
  expect(resolved.source).toBe(url);
  expect(parseManifest(resolved.text, resolved.source)).toEqual(names);
  return names;
}
