import { describe, expect, it } from "vitest";

import { resolveUv } from "./uv-runner.js";

describe("resolveUv", () => {
  it("returns null when uv doesn't answer --version (never a python fallback)", async () => {
    const out = await resolveUv({ run: async () => ({ ok: false, stdout: "", stderr: "" }) });
    expect(out).toBeNull();
  });

  it("probes exactly `uv --version`", async () => {
    const calls: [string, string[] | undefined][] = [];
    await resolveUv({
      run: async (cmd, args) => {
        calls.push([cmd, args]);
        return { ok: true, stdout: "uv 0.11.9", stderr: "" };
      },
    });
    expect(calls).toEqual([["uv", ["--version"]]]);
  });

  it("resolves the literal bin name on win32 (libuv reads PATH from the child env)", async () => {
    const out = await resolveUv({
      run: async () => ({ ok: true, stdout: "uv 0.11.9", stderr: "" }),
      platform: "win32",
      homeDir: "C:\\Users\\test",
      baseEnv: { PATH: "C:\\Windows\\System32" } as NodeJS.ProcessEnv,
    });
    expect(out?.bin).toBe("uv");
    expect(out?.env.PATH).toContain("C:\\Users\\test\\.local\\bin");
  });

  it("on POSIX with no real uv on any candidate PATH dir, falls back to the bare name (spawn then yields the honest ENOENT)", async () => {
    const out = await resolveUv({
      run: async () => ({ ok: true, stdout: "uv 0.11.9", stderr: "" }),
      platform: "linux",
      homeDir: "/home/test",
      baseEnv: { PATH: "/usr/bin" } as NodeJS.ProcessEnv,
    });
    expect(out?.bin).toBe("uv");
    expect(out?.env.PATH).toContain("/home/test/.local/bin");
  });
});
