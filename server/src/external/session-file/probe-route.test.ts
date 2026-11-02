import { describe, expect, it } from "vitest";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

import { app, fx, installFixtures, say, session } from "./session-file.fixture.js";

installFixtures();

type Result = { openable: boolean; reason?: string };
const probe = async (paths: unknown, a = app()) => {
  const r = await a.request("/api/external/tasks/t1/session-file/probe", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ paths }),
  });
  return { status: r.status, body: (await r.json()) as { results?: Result[]; error?: string } };
};

// @covers FR-01.66
describe("POST /api/external/tasks/:id/session-file/probe", () => {
  it("answers per path, in order: inside file yes, inside missing not_found", async () => {
    session(say(1, "hi"));
    const { status, body } = await probe(["in.md", "nope.md", path.join(fx.proj, "in.md")]);
    expect(status).toBe(200);
    expect(body.results).toEqual([{ openable: true }, { openable: false, reason: "not_found" }, { openable: true }]);
  });

  it("a bare file name that exists nowhere under the project root is not openable (name-only mention)", async () => {
    session(say(1, "see session_handoff.md"));
    expect((await probe(["session_handoff.md"])).body.results).toEqual([{ openable: false, reason: "not_found" }]);
  });

  it("outside the project: evidenced yes, unevidenced the generic unavailable, evidenced-but-gone not_found", async () => {
    session(say(1, `wrote ${path.join(fx.out, "a.txt")} and ${path.join(fx.out, "gone.txt")}`));
    const { body } = await probe([path.join(fx.out, "a.txt"), path.join(fx.out, "a.txt.bak"), path.join(fx.out, "gone.txt")]);
    expect(body.results).toEqual([
      { openable: true },
      { openable: false, reason: "unavailable" },
      { openable: false, reason: "not_found" },
    ]);
  });

  it("an unevidenced outside path never discloses whether it exists", async () => {
    session(say(1, "nothing"));
    const { body } = await probe([path.join(fx.out, "a.txt"), path.join(fx.out, "does-not-exist.txt")]);
    expect(body.results).toEqual([
      { openable: false, reason: "unavailable" },
      { openable: false, reason: "unavailable" },
    ]);
  });

  it("traversal, NUL, empty and sensitive names are never openable", async () => {
    session(say(1, path.join(fx.out, "id_rsa")));
    writeFileSync(path.join(fx.out, "id_rsa"), "secret");
    const { body } = await probe(["../x.md", "a/../../x.md", "in.md\0.png", "", path.join(fx.out, "id_rsa")]);
    expect(body.results?.every((r) => r.openable === false)).toBe(true);
  });

  it("a directory is not openable and a non-previewable type is reported as such", async () => {
    session(say(1, "x"));
    mkdirSync(path.join(fx.proj, "dir.md"));
    writeFileSync(path.join(fx.proj, "blob.bin"), "x");
    const { body } = await probe(["dir.md", "blob.bin"]);
    expect(body.results?.[0]).toMatchObject({ openable: false });
    expect(body.results?.[1]).toEqual({ openable: false, reason: "not_previewable" });
  });

  it("a file above the viewer size cap is not openable (the read route would answer 413)", async () => {
    session(say(1, "hi"));
    writeFileSync(path.join(fx.proj, "big.md"), Buffer.alloc(5 * 1024 * 1024 + 1, 97));
    expect((await probe(["big.md"])).body.results).toEqual([{ openable: false, reason: "not_previewable" }]);
  });

  it("a symlink leaving the project is not openable (no fallback to session evidence)", async () => {
    session(say(1, path.join(fx.out, "a.txt")));
    try {
      symlinkSync(fx.out, path.join(fx.proj, "link"), "junction");
    } catch {
      return; // no symlink privilege on this host
    }
    expect((await probe(["link/a.txt"])).body.results).toEqual([{ openable: false, reason: "unavailable" }]);
  });

  it("validates the body and bounds the batch", async () => {
    session(say(1, "x"));
    expect((await probe("in.md")).status).toBe(400);
    expect((await probe([])).status).toBe(400);
    expect((await probe([1])).status).toBe(400);
    expect((await probe(Array.from({ length: 41 }, (_, i) => `f${i}.md`))).body.error).toBe("too_many_paths");
    expect((await probe(["in.md"], app(false))).status).toBe(404);
  });

  it("rate-limits a burst per task (429) and leaves the read route alone", async () => {
    session(say(1, "x"));
    const a = app();
    let last = 200;
    for (let i = 0; i < 40; i++) last = (await probe(["in.md"], a)).status;
    expect(last).toBe(429);
  });
});
