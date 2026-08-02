/**
 * marketplace-contract-rules.test.mjs — THE RULE ITSELF, offline.
 *
 * One of two deterministic halves of the marketplace contract (its sibling,
 * marketplace-contract-probe.test.mjs, covers how the probe behaves; the live
 * read lives in marketplace-contract.test.mjs). Here: what counts as a
 * retrieved-but-wrong manifest, the full skip-vs-fail decision table, and the
 * guarantee that an unverified run is announced rather than swallowed.
 *
 * These run offline on every `npm test`, so the convention is under test even on
 * the days the live probe cannot run — which is the whole point of separating
 * "could not ask" from "asked and got a bad answer".
 */

import { describe, it, expect, vi } from "vitest";
import {
  classifyFetchOutcome,
  reportInconsistentEndpoint,
  reportUnverified,
} from "./helpers/network-verdict.mjs";
import { assertManifestContract, CONTRACT_TITLE } from "./helpers/manifest-probe.mjs";
import { URL_STUB, good } from "./helpers/manifest-fixtures.mjs";

describe("marketplace contract — a retrieved-but-wrong manifest is RED", () => {
  const cases = [
    ["not JSON at all", "<html>404</html>"],
    ["an empty body", ""],
    ["JSON with no plugins[]", JSON.stringify({ name: "shipwright", version: "1" })],
    [
      "a plugin entry with no name",
      JSON.stringify({ name: "shipwright", plugins: [{ source: "./x" }] }),
    ],
    [
      "a shell-metacharacter name",
      JSON.stringify({ name: "shipwright", plugins: [{ name: "a; rm -rf /", source: "./x" }] }),
    ],
    ["an empty plugin list", JSON.stringify({ name: "shipwright", plugins: [] })],
    // The two fields parseManifest never reads — see assertManifestContract.
    [
      "a RENAMED marketplace (the id four lib/ call sites hardcode)",
      JSON.stringify({ name: "shipwright-plugins", plugins: [{ name: "a", source: "./a" }] }),
    ],
    [
      "a plugin entry with no installable source",
      JSON.stringify({ name: "shipwright", plugins: [{ name: "a" }] }),
    ],
    [
      "a plugin entry whose source is blank",
      JSON.stringify({ name: "shipwright", plugins: [{ name: "a", source: "   " }] }),
    ],
  ];

  for (const [label, body] of cases) {
    it(`${label} -> the contract assertion throws`, async () => {
      await expect(assertManifestContract(body, URL_STUB)).rejects.toThrow();
    });
  }

  it("a well-formed manifest passes and returns the installer's list", async () => {
    await expect(assertManifestContract(good(["a", "b"]), URL_STUB)).resolves.toEqual(["a", "b"]);
  });

  it("a 15th plugin is NOT drift — the list stays uncoupled", async () => {
    const fifteen = Array.from({ length: 15 }, (_, i) => `plugin-${i + 1}`);
    await expect(assertManifestContract(good(fifteen), URL_STUB)).resolves.toHaveLength(15);
  });
});

describe("marketplace contract — the skip-vs-fail rule (offline, deterministic)", () => {
  it("2xx is a real answer and gets checked", () => {
    for (const status of [200, 204, 299]) {
      expect(classifyFetchOutcome({ status }).verdict).toBe("check");
    }
  });

  it("a rate limit is a refusal to answer, not an answer -> skip", () => {
    expect(classifyFetchOutcome({ status: 429 }).verdict).toBe("skip");
  });

  it("producer-side 5xx -> skip", () => {
    for (const status of [500, 502, 503, 599]) {
      expect(classifyFetchOutcome({ status }).verdict).toBe("skip");
    }
  });

  it("404 is DRIFT, not an outage -> fail", () => {
    const out = classifyFetchOutcome({ status: 404 });
    expect(out.verdict).toBe("fail");
    expect(out.reason).toMatch(/drift, not an outage/);
  });

  it("403 -> fail (npx fetches unauthenticated; users get the same answer)", () => {
    expect(classifyFetchOutcome({ status: 403 }).verdict).toBe("fail");
  });

  it("every other non-2xx -> fail, never a silent skip", () => {
    for (const status of [301, 400, 401, 418, 451]) {
      expect(classifyFetchOutcome({ status }).verdict).toBe("fail");
    }
  });

  it("a DNS failure -> skip, naming the errno", () => {
    const error = Object.assign(new TypeError("fetch failed"), { cause: { code: "ENOTFOUND" } });
    const out = classifyFetchOutcome({ transportError: error });
    expect(out.verdict).toBe("skip");
    expect(out.reason).toMatch(/ENOTFOUND/);
  });

  it("our own deadline expiring -> skip", () => {
    const error = Object.assign(new Error("This operation was aborted"), { name: "AbortError" });
    expect(classifyFetchOutcome({ transportError: error }).verdict).toBe("skip");
  });

  it("a malformed URL is a DEFECT, not an outage -> fail", () => {
    const error = Object.assign(new TypeError("Failed to parse URL from undefined"), {
      cause: { code: "ERR_INVALID_URL" },
    });
    expect(classifyFetchOutcome({ transportError: error }).verdict).toBe("fail");
  });

  it("an ambiguous call throws rather than defaulting to skip", () => {
    expect(() => classifyFetchOutcome({})).toThrow(/got neither/);
    expect(() => classifyFetchOutcome({ transportError: new Error("x"), status: 500 })).toThrow(
      /never both/,
    );
    expect(() => classifyFetchOutcome({ status: "200" })).toThrow(/must be an integer/);
  });
});

describe("marketplace contract — an unverified run is announced, not swallowed", () => {
  it("warns, annotates, and writes the step summary under GitHub Actions", () => {
    const warn = vi.fn();
    const emit = vi.fn();
    const summary = vi.fn();
    const message = reportUnverified(
      { title: CONTRACT_TITLE, reason: "transport failure: TypeError: fetch failed (ENOTFOUND)" },
      { warn, emit, summary, isActions: true },
    );

    expect(message).toMatch(/NOT VERIFIED/);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/\[contract\].*NOT VERIFIED/);
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit.mock.calls[0][0]).toMatch(/^::warning title=marketplace manifest contract::/);
    expect(emit.mock.calls[0][0]).toMatch(/ENOTFOUND/);
    expect(summary).toHaveBeenCalledTimes(1);
    expect(summary.mock.calls[0][0]).toMatch(/NOT VERIFIED/);
  });

  it("emits no annotation and no summary outside GitHub Actions, but still warns", () => {
    const warn = vi.fn();
    const emit = vi.fn();
    const summary = vi.fn();
    reportUnverified(
      { title: CONTRACT_TITLE, reason: "offline" },
      { warn, emit, summary, isActions: false },
    );
    expect(warn).toHaveBeenCalledTimes(1);
    expect(emit).not.toHaveBeenCalled();
    expect(summary).not.toHaveBeenCalled();
  });

  it("a failing summary channel never takes the build down with it", () => {
    // The summary is best-effort observability; if the runner file is missing or
    // read-only, the skip must still be a skip, not an error.
    const summary = vi.fn(() => {
      throw new Error("EACCES");
    });
    expect(() =>
      reportUnverified(
        { title: CONTRACT_TITLE, reason: "offline" },
        { warn: () => {}, emit: () => {}, summary, isActions: true },
      ),
    ).not.toThrow();
  });

  it("an inconsistent endpoint is announced on the same four channels", () => {
    const warn = vi.fn();
    const emit = vi.fn();
    const summary = vi.fn();
    const message = reportInconsistentEndpoint(
      { title: CONTRACT_TITLE, firstReason: "HTTP 404 — a definite response" },
      { warn, emit, summary, isActions: true },
    );

    expect(message).toMatch(/answered inconsistently/);
    expect(message).toMatch(/404/);
    // NOT the unverified wording — this run WAS verified, on the retry.
    expect(message).not.toMatch(/NOT VERIFIED/);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledTimes(1);
    expect(summary).toHaveBeenCalledTimes(1);
  });

  it("escapes annotation payloads so a multi-line reason cannot forge a command", () => {
    const emit = vi.fn();
    const nasty = ["a", "::error::forged", "100% done"].join(String.fromCharCode(10));
    reportUnverified(
      { title: CONTRACT_TITLE, reason: nasty },
      { warn: () => {}, emit, summary: () => {}, isActions: true },
    );
    const line = emit.mock.calls[0][0];
    expect(line.split(String.fromCharCode(10))).toHaveLength(1);
    expect(line).toContain("%0A");
    expect(line).toContain("%25");
  });
});
