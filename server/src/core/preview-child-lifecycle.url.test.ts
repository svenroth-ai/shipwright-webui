import { describe, it, expect } from "vitest";

import { buildPreviewUrl } from "./preview-child-lifecycle.js";

describe("buildPreviewUrl", () => {
  // @covers FR-01.17
  it("uses the profile's 127.0.0.1 host (Host-header-checking companion)", () => {
    expect(buildPreviewUrl(3911, "/", "127.0.0.1")).toBe("http://127.0.0.1:3911");
    expect(buildPreviewUrl(3911, "/board?x=1", "127.0.0.1")).toBe(
      "http://127.0.0.1:3911/board?x=1",
    );
  });

  // @covers FR-01.17
  it("falls back to localhost for a host outside the allowlist", () => {
    expect(buildPreviewUrl(3911, "/", "evil.com")).toBe("http://localhost:3911");
    expect(buildPreviewUrl(3911, "/", "")).toBe("http://localhost:3911");
  });

  // @covers FR-01.17
  it("still rejects authority smuggling under a 127.0.0.1 host", () => {
    expect(buildPreviewUrl(3911, "http://localhost:3911/", "127.0.0.1")).toBe(
      "http://127.0.0.1:3911",
    );
  });

  it("renders host-only for a root path (no trailing slash)", () => {
    expect(buildPreviewUrl(5173, "/")).toBe("http://localhost:5173");
  });

  it("appends a normal path", () => {
    expect(buildPreviewUrl(5173, "/dashboard")).toBe(
      "http://localhost:5173/dashboard",
    );
  });

  it("normalizes a slash-less path into an openable URL", () => {
    expect(buildPreviewUrl(5173, "dashboard")).toBe(
      "http://localhost:5173/dashboard",
    );
  });

  it("keeps a smuggled '@evil.com/' authority on-host as a path", () => {
    expect(buildPreviewUrl(5173, "@evil.com/")).toBe(
      "http://localhost:5173/evil.com/",
    );
  });

  it("preserves query + hash on a normal path", () => {
    expect(buildPreviewUrl(5173, "/app?x=1#top")).toBe(
      "http://localhost:5173/app?x=1#top",
    );
  });

  it("preserves a leading query / fragment on the origin", () => {
    expect(buildPreviewUrl(5173, "?tab=1")).toBe("http://localhost:5173/?tab=1");
  });

  it("falls back to the bare origin for an absolute off-host URL", () => {
    expect(buildPreviewUrl(5173, "http://evil.com/steal")).toBe(
      "http://localhost:5173",
    );
  });

  it("falls back to the bare origin for a non-http scheme (javascript:/data:)", () => {
    expect(buildPreviewUrl(5173, "javascript:alert(1)")).toBe(
      "http://localhost:5173",
    );
    expect(buildPreviewUrl(5173, "data:text/html,<script>x</script>")).toBe(
      "http://localhost:5173",
    );
  });

  it("falls back to the bare origin when a backslash smuggles an authority", () => {
    // JS "\\\\evil.com" === literal \\evil.com → URL normalizes to //evil.com.
    expect(buildPreviewUrl(5173, "\\\\evil.com/x")).toBe(
      "http://localhost:5173",
    );
  });

  it("falls back to the bare origin via catch on a malformed absolute path", () => {
    expect(buildPreviewUrl(5173, "http://[")).toBe("http://localhost:5173");
  });
});
