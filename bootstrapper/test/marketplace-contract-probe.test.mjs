/**
 * marketplace-contract-probe.test.mjs — HOW THE PROBE BEHAVES, offline.
 *
 * One of two deterministic halves of the marketplace contract (its sibling,
 * marketplace-contract-rules.test.mjs, covers the decision rule itself and the
 * loudness guarantees; the live read lives in marketplace-contract.test.mjs).
 *
 * WHY A DETERMINISTIC HALF EXISTS AT ALL. The live probe can legitimately skip —
 * the network is not ours — and a rule exercised only when the network happens
 * to be down is a rule nobody is checking. Everything here runs offline on every
 * `npm test`, so on the day the live probe skips, the only thing left untested
 * is the live read itself.
 */

import { describe, it, expect, vi } from "vitest";
import { verificationIsMandatory } from "./helpers/network-verdict.mjs";
import { probeManifestOnce } from "./helpers/manifest-probe.mjs";
import { URL_STUB, good, probe } from "./helpers/manifest-fixtures.mjs";

describe("marketplace contract — the probe wiring (offline, deterministic)", () => {
  const ok = (body) => async () => ({ ok: true, status: 200, text: async () => body });

  it("a 2xx hands the body on for checking", async () => {
    const out = await probe({ fetchImpl: ok("{}"), url: URL_STUB });
    expect(out).toMatchObject({ verdict: "check", text: "{}" });
  });

  it("a refused connection becomes a skip, not a failure", async () => {
    const fetchImpl = async () => {
      throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });
    };
    const out = await probe({ fetchImpl, url: URL_STUB });
    expect(out.verdict).toBe("skip");
    expect(out.reason).toMatch(/ECONNREFUSED/);
  });

  it("a 404 becomes a FAIL — the manifest left the path the installer fetches", async () => {
    const fetchImpl = async () => ({ ok: false, status: 404, text: async () => "Not Found" });
    expect((await probe({ fetchImpl, url: URL_STUB })).verdict).toBe("fail");
  });

  it("a 503 becomes a skip and never reads the body", async () => {
    const text = vi.fn();
    const fetchImpl = async () => ({ ok: false, status: 503, text });
    expect((await probe({ fetchImpl, url: URL_STUB })).verdict).toBe("skip");
    expect(text).not.toHaveBeenCalled();
  });

  it("a body that dies mid-read is a skip (no complete answer arrived)", async () => {
    const fetchImpl = async () => ({
      ok: true,
      status: 200,
      text: async () => {
        throw Object.assign(new TypeError("terminated"), { cause: { code: "UND_ERR_SOCKET" } });
      },
    });
    expect((await probe({ fetchImpl, url: URL_STUB })).verdict).toBe("skip");
  });

  it("a MALFORMED url fails — a coding defect must not wear a transport skip", async () => {
    const fetchImpl = async () => {
      throw Object.assign(new TypeError("Failed to parse URL from undefined"), {
        cause: { code: "ERR_INVALID_URL" },
      });
    };
    const out = await probe({ fetchImpl, url: undefined });
    expect(out.verdict).toBe("fail");
    expect(out.reason).toMatch(/malformed/);
  });

  it("the deadline is enforced, and its timer is always cleared", async () => {
    // Both halves asserted: dropping the `finally { clearTimeout(timer) }` would
    // leave a stray timer holding the event loop open for the full timeout.
    const cleared = vi.spyOn(globalThis, "clearTimeout");
    try {
      const fetchImpl = (url, init) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener("abort", () =>
            reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
          );
        });
      const out = await probeManifestOnce({ fetchImpl, url: URL_STUB, timeoutMs: 20 });
      expect(out.verdict).toBe("skip");
      expect(out.reason).toMatch(/deadline/);
      expect(cleared).toHaveBeenCalledTimes(1);
    } finally {
      cleared.mockRestore();
    }
  });

  it("clears the timer on the happy path too", async () => {
    const cleared = vi.spyOn(globalThis, "clearTimeout");
    try {
      await probeManifestOnce({ fetchImpl: ok("{}"), url: URL_STUB });
      expect(cleared).toHaveBeenCalledTimes(1);
    } finally {
      cleared.mockRestore();
    }
  });
});

describe("marketplace contract — one retry, and only where it helps", () => {
  it("a transient 404 from one CDN edge does NOT red an unrelated PR", async () => {
    let call = 0;
    const fetchImpl = async () => {
      call += 1;
      return call === 1
        ? { ok: false, status: 404, text: async () => "Not Found" }
        : { ok: true, status: 200, text: async () => good(["a"]) };
    };
    const out = await probe({ fetchImpl, url: URL_STUB });
    expect(out.verdict).toBe("check");
    expect(call).toBe(2);
    // …but it is NOT forgiven silently: the caller announces the disagreement.
    expect(out.recoveredFrom).toMatch(/404/);
  });

  it("a clean first read carries no recovery marker", async () => {
    const fetchImpl = async () => ({ ok: true, status: 200, text: async () => good(["a"]) });
    const out = await probe({ fetchImpl, url: URL_STUB });
    expect(out.verdict).toBe("check");
    expect(out.recoveredFrom).toBeUndefined();
  });

  it("REAL drift is persistent, so it survives the retry and stays red", async () => {
    const fetchImpl = async () => ({ ok: false, status: 404, text: async () => "Not Found" });
    const out = await probe({ fetchImpl, url: URL_STUB });
    expect(out.verdict).toBe("fail");
    expect(out.reason).toMatch(/confirmed on a second attempt/);
  });

  it("does not retry a skip — it is already harmless, and a retry doubles the wait", async () => {
    let call = 0;
    const fetchImpl = async () => {
      call += 1;
      return { ok: false, status: 503, text: async () => "" };
    };
    expect((await probe({ fetchImpl, url: URL_STUB })).verdict).toBe("skip");
    expect(call).toBe(1);
  });

  it("does not retry a success", async () => {
    let call = 0;
    const fetchImpl = async () => {
      call += 1;
      return { ok: true, status: 200, text: async () => good(["a"]) };
    };
    expect((await probe({ fetchImpl, url: URL_STUB })).verdict).toBe("check");
    expect(call).toBe(1);
  });
});

describe("marketplace contract — when 'could not check' must fail instead of skip", () => {
  it("a scheduled run REQUIRES verification", () => {
    expect(verificationIsMandatory({ GITHUB_EVENT_NAME: "schedule" })).toBe(true);
  });

  it("a pull request does not — an outage must never block a contributor", () => {
    expect(verificationIsMandatory({ GITHUB_EVENT_NAME: "pull_request" })).toBe(false);
    expect(verificationIsMandatory({ GITHUB_EVENT_NAME: "push" })).toBe(false);
    expect(verificationIsMandatory({})).toBe(false);
  });

  it("the env override forces either answer", () => {
    const on = { SHIPWRIGHT_REQUIRE_MANIFEST_VERIFICATION: "1" };
    const off = { GITHUB_EVENT_NAME: "schedule", SHIPWRIGHT_REQUIRE_MANIFEST_VERIFICATION: "0" };
    expect(verificationIsMandatory(on)).toBe(true);
    expect(verificationIsMandatory(off)).toBe(false);
    expect(verificationIsMandatory({ SHIPWRIGHT_REQUIRE_MANIFEST_VERIFICATION: "false" })).toBe(
      false,
    );
    // An empty value is "unset", not "off" — CI commonly exports empty strings.
    expect(
      verificationIsMandatory({
        GITHUB_EVENT_NAME: "schedule",
        SHIPWRIGHT_REQUIRE_MANIFEST_VERIFICATION: "",
      }),
    ).toBe(true);
  });

  it("tolerates the whitespace CI env-var quoting adds", () => {
    // " 0" untrimmed reads as "on" and would turn an intended opt-OUT into a
    // hard failure. Raised by the Tier-3 PR review.
    expect(
      verificationIsMandatory({ SHIPWRIGHT_REQUIRE_MANIFEST_VERIFICATION: " 0 " }),
    ).toBe(false);
    expect(
      verificationIsMandatory({ SHIPWRIGHT_REQUIRE_MANIFEST_VERIFICATION: " FALSE " }),
    ).toBe(false);
    expect(verificationIsMandatory({ SHIPWRIGHT_REQUIRE_MANIFEST_VERIFICATION: " 1 " })).toBe(true);
    expect(verificationIsMandatory({ GITHUB_EVENT_NAME: " schedule " })).toBe(true);
    // All-whitespace is "unset", so the event decides.
    expect(
      verificationIsMandatory({
        GITHUB_EVENT_NAME: "pull_request",
        SHIPWRIGHT_REQUIRE_MANIFEST_VERIFICATION: "   ",
      }),
    ).toBe(false);
  });
});
