/*
 * create-node-pty-spawn-fn.test.ts — external-code-review finding (GLM
 * MEDIUM, 2026-09-16): the Codex pty spawn (`ws-upgrade-handler.ts`) passes
 * only `{SHIPWRIGHT_SESSION_ID}` as `opts.env`, with a comment claiming
 * `buildSpawnEnv` merges it over `process.env` — but only the pure
 * `buildSpawnEnv` helper (pty-env-flicker.test.ts) and a fake injected
 * `PtySpawnFn` (pty-manager tests) were covered end-to-end. Neither proved
 * `createNodePtySpawnFn`'s own closure (the REAL production wiring) routes
 * `opts.env` through `buildSpawnEnv` before calling the real
 * `@lydell/node-pty` spawn — if it hadn't, a Codex pty would receive ONLY
 * `SHIPWRIGHT_SESSION_ID` and lose PATH/HOME entirely.
 *
 * Mocks `@lydell/node-pty`'s `spawn` (native binary, no real process) to
 * inspect exactly what env `createNodePtySpawnFn` hands it.
 */
import { describe, expect, it, vi } from "vitest";

const spawnSpy = vi.fn(() => ({
  pid: 1,
  onData: vi.fn(),
  onExit: vi.fn(),
  write: vi.fn(),
  resize: vi.fn(),
  kill: vi.fn(),
}));

vi.mock("@lydell/node-pty", () => ({
  spawn: spawnSpy,
}));

describe("createNodePtySpawnFn — real env-merge wiring (external-code-review finding)", () => {
  it("merges caller-supplied env (e.g. SHIPWRIGHT_SESSION_ID) over the full process.env, never replacing it", async () => {
    const { createNodePtySpawnFn } = await import("./routes.js");
    const spawnFn = await createNodePtySpawnFn();

    const priorPath = process.env.PATH;
    spawnFn("bash", [], {
      cwd: "/tmp/proj",
      env: { SHIPWRIGHT_SESSION_ID: "sess-abc" },
    });

    expect(spawnSpy).toHaveBeenCalledTimes(1);
    const [, , ptyOpts] = spawnSpy.mock.calls[0]!;
    const env = (ptyOpts as { env: Record<string, string | undefined> }).env;
    // The caller-supplied override made it through...
    expect(env.SHIPWRIGHT_SESSION_ID).toBe("sess-abc");
    // ...WITHOUT clobbering the base process.env (PATH survives, so a
    // spawned Codex pty can still find the `codex` binary and any other
    // shell command it needs).
    expect(env.PATH).toBe(priorPath);
  });

  it("with no caller env, still passes the full process.env through untouched", async () => {
    const { createNodePtySpawnFn } = await import("./routes.js");
    const spawnFn = await createNodePtySpawnFn();

    spawnFn("bash", [], { cwd: "/tmp/proj" });

    const [, , ptyOpts] = spawnSpy.mock.calls.at(-1)!;
    const env = (ptyOpts as { env: Record<string, string | undefined> }).env;
    expect(env.PATH).toBe(process.env.PATH);
  });
});
