import { describe, it, expect } from "vitest";
import {
  fetchLatestVersion,
  evaluateStaleness,
  checkForStaleCopy,
  staleBanner,
} from "../lib/version-check.mjs";

/** Minimal Response stub. */
function res(ok, body) {
  return { ok, json: async () => body, text: async () => JSON.stringify(body) };
}

describe("version-check — AC6 stale-copy self-check", () => {
  it("newer registry version → stale, banner names @latest", async () => {
    const fetchImpl = async () => res(true, { version: "0.24.0" });
    const verdict = await checkForStaleCopy("0.23.0", { fetchImpl });
    expect(verdict.stale).toBe(true);
    expect(verdict.latest).toBe("0.24.0");
    expect(staleBanner(verdict)).toContain("npx @svenroth-ai/shipwright@latest");
  });

  it("same version → not stale, no banner", async () => {
    const fetchImpl = async () => res(true, { version: "0.23.0" });
    const verdict = await checkForStaleCopy("0.23.0", { fetchImpl });
    expect(verdict.stale).toBe(false);
    expect(staleBanner(verdict)).toBeNull();
  });

  it("network error → offline-safe: no banner, no throw", async () => {
    const fetchImpl = async () => {
      throw new Error("ENOTFOUND registry.npmjs.org");
    };
    const verdict = await checkForStaleCopy("0.23.0", { fetchImpl });
    expect(verdict.stale).toBe(false);
    expect(verdict.latest).toBeNull();
    expect(staleBanner(verdict)).toBeNull();
  });

  it("non-200 / garbled body → latest null, never throws", async () => {
    expect(await fetchLatestVersion({ fetchImpl: async () => res(false, {}) })).toBeNull();
    expect(await fetchLatestVersion({ fetchImpl: async () => res(true, { version: "not-semver" }) })).toBeNull();
  });

  it("evaluateStaleness with unknown latest is not stale", () => {
    expect(evaluateStaleness("0.23.0", null).stale).toBe(false);
  });
});
