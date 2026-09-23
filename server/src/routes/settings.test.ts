import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import { createSettingsRoutes } from "./settings.js";

function setup(existing?: string) {
  const storage: Record<string, string> = {};
  if (existing) storage["/tmp/settings.json"] = existing;
  const deps = {
    readFile: vi.fn(async (p: string) => storage[p] ?? ""),
    writeFile: vi.fn(async (p: string, d: string) => { storage[p] = d; }),
    existsSync: vi.fn((p: string) => p in storage),
    mkdirSync: vi.fn(),
  };
  const app = new Hono();
  app.route("/", createSettingsRoutes("/tmp/settings.json", deps));
  return { app, storage };
}

describe("Settings Routes", () => {
  // @covers FR-01.06
  it("GET /api/settings returns defaults when no file", async () => {
    const { app } = setup();
    const res = await app.request("/api/settings");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.port).toBe(3847);
    expect(body.data.maxConcurrent).toBe(3);
  });

  // PR-review finding, iterate-2026-09-23 fourth round — a fresh install's
  // default payload must use only the renamed field.
  it("GET /api/settings's fresh-install defaults use only the renamed runtimeDefault field", async () => {
    const { app } = setup();
    const res = await app.request("/api/settings");
    const body = await res.json();
    expect(body.data.runtimeDefault).toBe("claude");
    expect(body.data).not.toHaveProperty("codexRuntimeDefault");
  });

  // PR-review BLOCK fix, iterate-2026-09-23 fifth round — codextenderPort is
  // interpolated into an outbound proxy URL server-side; an unvalidated
  // value must never reach disk.
  it("PUT /api/settings rejects a non-integer/out-of-range codextenderPort with 400, and does not persist it", async () => {
    const { app, storage } = setup();
    for (const bad of ["4000@attacker.example", 4000.5, 0, 65536, "4000"]) {
      const res = await app.request("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ codextenderPort: bad }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("invalid_codextender_port");
    }
    expect(storage["/tmp/settings.json"]).toBeUndefined();
  });

  it("PUT /api/settings accepts a valid codextenderPort", async () => {
    const { app } = setup();
    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ codextenderPort: 4100 }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.codextenderPort).toBe(4100);
  });

  // @covers FR-01.06
  it("PUT /api/settings persists and returns updated", async () => {
    const { app } = setup();
    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ maxConcurrent: 5 }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.maxConcurrent).toBe(5);
    expect(body.data.port).toBe(3847); // default preserved
  });

  // @covers FR-01.06
  it("PUT /api/settings merges with existing", async () => {
    const { app } = setup(JSON.stringify({ maxConcurrent: 5, defaultAutonomy: "autonomous" }));
    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ maxConcurrent: 8 }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.maxConcurrent).toBe(8);
    expect(body.data.defaultAutonomy).toBe("autonomous"); // preserved from existing
  });

  // @covers FR-01.06
  it("GET /api/settings reads existing file", async () => {
    const { app } = setup(JSON.stringify({ maxConcurrent: 7, defaultProfile: "supabase-nextjs" }));
    const res = await app.request("/api/settings");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.maxConcurrent).toBe(7);
    expect(body.data.defaultProfile).toBe("supabase-nextjs");
  });

  // @covers FR-01.06
  it("PUT /api/settings with phaseToStatusMapping persists it", async () => {
    const { app, storage } = setup();
    const mapping = { project: "backlog", build: "in_progress", test: "in_review", deploy: "done" };
    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phaseToStatusMapping: mapping }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.phaseToStatusMapping).toEqual(mapping);
    // Also check that it was written to the file
    const written = JSON.parse(storage["/tmp/settings.json"]);
    expect(written.phaseToStatusMapping).toEqual(mapping);
  });

  // @covers FR-01.06
  it("PUT /api/settings with defaultAutonomy persists it", async () => {
    const { app } = setup();
    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ defaultAutonomy: "autonomous" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.defaultAutonomy).toBe("autonomous");
  });

  // Iterate 14.8.2 — defaultModel + defaultMode
  // @covers FR-01.06
  it("GET /api/settings returns defaultModel when persisted", async () => {
    const { app } = setup(JSON.stringify({ defaultModel: "claude-opus-4-6" }));
    const res = await app.request("/api/settings");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.defaultModel).toBe("claude-opus-4-6");
  });

  // @covers FR-01.06
  it("GET /api/settings returns defaultMode when persisted", async () => {
    const { app } = setup(JSON.stringify({ defaultMode: "acceptEdits" }));
    const res = await app.request("/api/settings");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.defaultMode).toBe("acceptEdits");
  });

  // @covers FR-01.06
  it("PUT /api/settings with defaultModel persists and returns it", async () => {
    const { app, storage } = setup();
    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ defaultModel: "claude-sonnet-4-6" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.defaultModel).toBe("claude-sonnet-4-6");
    const written = JSON.parse(storage["/tmp/settings.json"]);
    expect(written.defaultModel).toBe("claude-sonnet-4-6");
  });

  // @covers FR-01.06
  it("PUT /api/settings with defaultMode persists and returns it", async () => {
    const { app, storage } = setup();
    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ defaultMode: "plan" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.defaultMode).toBe("plan");
    const written = JSON.parse(storage["/tmp/settings.json"]);
    expect(written.defaultMode).toBe("plan");
  });

  // @covers FR-01.06
  it("PUT /api/settings with both defaultModel and defaultMode together", async () => {
    const { app } = setup();
    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ defaultModel: "claude-haiku-4-5", defaultMode: "bypassPermissions" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.defaultModel).toBe("claude-haiku-4-5");
    expect(body.data.defaultMode).toBe("bypassPermissions");
  });

  // PR-review finding, iterate-2026-09-23 — codexRuntimeDefault -> runtimeDefault rename
  it("GET /api/settings migrates a pre-rename codexRuntimeDefault to runtimeDefault", async () => {
    const { app } = setup(JSON.stringify({ codexRuntimeDefault: "codex" }));
    const res = await app.request("/api/settings");
    const body = await res.json();
    expect(body.data.runtimeDefault).toBe("codex");
  });

  it("PUT /api/settings migrates a pre-rename codexRuntimeDefault from the existing file when the body doesn't touch it", async () => {
    const { app } = setup(JSON.stringify({ codexRuntimeDefault: "codex" }));
    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ maxConcurrent: 9 }),
    });
    const body = await res.json();
    expect(body.data.runtimeDefault).toBe("codex");
    expect(body.data.maxConcurrent).toBe(9);
  });
});
