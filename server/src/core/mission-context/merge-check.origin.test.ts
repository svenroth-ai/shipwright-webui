/*
 * merge-check.origin.test.ts — the PR-marker REPO BINDING (internal code
 * review, MEDIUM).
 *
 * "Delivered" must be a real observation about THIS repo. A shipwright session
 * routinely cites a sibling repo's PR after its own webui link, and PR numbers
 * across `shipwright` and `shipwright-webui` overlap almost completely, so an
 * unbound marker could grep our own origin/main for a foreign number and render
 * a false merge.
 *
 * @covers FR-01.66
 */

import { beforeEach, describe, expect, it } from "vitest";

import {
  _clearOriginSlugCache,
  extractPrMarker,
  parseOriginSlug,
  readOriginSlug,
} from "./merge-check.js";

/*
 * Internal code review (MEDIUM) — a FOREIGN PR number must never drive the
 * merge check.
 *
 * A shipwright session routinely cites a sibling repo's PR after its own webui
 * link, and PR numbers across `shipwright` and `shipwright-webui` overlap
 * almost completely — webui has its own #290. Grepping webui's origin/main for
 * a shipwright PR number would render a false "Delivered", which is exactly the
 * claim CONTRACT §5.3 says must be real.
 */
describe("PR marker repo binding", () => {
  const WEBUI_SLUG = { owner: "svenroth-ai", repo: "shipwright-webui" };

  it("IGNORES a sibling repo's PR even when it is the LAST marker", () => {
    const transcript = [
      "opened https://github.com/svenroth-ai/shipwright-webui/pull/292",
      "see also https://github.com/svenroth-ai/shipwright/pull/290",
    ].join("\n");
    // The last marker is the sibling's #290; ours is #292. Without the binding
    // this would grep webui's origin/main for (#290) — a real, existing webui PR.
    expect(extractPrMarker(transcript, WEBUI_SLUG)?.number).toBe(292);
  });

  it("returns null when ONLY a foreign PR is cited (never falls back to it)", () => {
    const transcript = "context: https://github.com/svenroth-ai/shipwright/pull/290";
    expect(extractPrMarker(transcript, WEBUI_SLUG)).toBeNull();
  });

  it("returns null when the origin repo cannot be determined", () => {
    // Cannot prove the marker is ours -> decline, so merge stays `unknown`.
    expect(
      extractPrMarker("https://github.com/svenroth-ai/shipwright-webui/pull/292", null),
    ).toBeNull();
  });

  it("matches owner/repo case-insensitively (GitHub semantics)", () => {
    expect(
      extractPrMarker("https://github.com/SvenRoth-AI/Shipwright-WebUI/pull/7", WEBUI_SLUG)?.number,
    ).toBe(7);
  });
});

describe("parseOriginSlug", () => {
  it("parses https, ssh and .git-suffixed remotes", () => {
    for (const url of [
      "https://github.com/svenroth-ai/shipwright-webui.git",
      "https://github.com/svenroth-ai/shipwright-webui",
      "git@github.com:svenroth-ai/shipwright-webui.git",
      "ssh://git@github.com/svenroth-ai/shipwright-webui.git",
      "https://x-access-token:abc@github.com/svenroth-ai/shipwright-webui.git",
    ]) {
      expect(parseOriginSlug(url), url).toEqual({
        owner: "svenroth-ai",
        repo: "shipwright-webui",
      });
    }
  });

  it("returns null for a non-github or malformed remote", () => {
    for (const url of [
      "https://gitlab.com/o/r.git",
      "https://github.com.evil.com/o/r.git",
      "",
      null,
      undefined,
      "not a url",
    ]) {
      expect(parseOriginSlug(url), String(url)).toBeNull();
    }
  });
});

describe("readOriginSlug", () => {
  beforeEach(() => _clearOriginSlugCache());

  it("reads + memoizes the slug via an arg-array git call", async () => {
    let calls = 0;
    const git = (args: string[]) => {
      calls++;
      expect(args).toEqual(["remote", "get-url", "origin"]);
      return "https://github.com/svenroth-ai/shipwright-webui.git\n";
    };
    expect(await readOriginSlug("/p", git)).toEqual({
      owner: "svenroth-ai",
      repo: "shipwright-webui",
    });
    expect(await readOriginSlug("/p", git)).not.toBeNull();
    expect(calls).toBe(1);
  });

  it("returns null (and caches it) when there is no origin remote", async () => {
    const git = () => {
      throw new Error("no such remote");
    };
    expect(await readOriginSlug("/no-remote", git)).toBeNull();
  });
});
