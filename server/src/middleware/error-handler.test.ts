import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { AppError, errorHandler } from "./error-handler.js";

describe("AppError", () => {
  it("creates error with status code", () => {
    const err = new AppError("Not found", 404);
    expect(err.message).toBe("Not found");
    expect(err.statusCode).toBe(404);
    expect(err).toBeInstanceOf(Error);
  });

  it("supports optional detail field", () => {
    const err = new AppError("Bad request", 400, "Email is required");
    expect(err.detail).toBe("Email is required");
  });
});

describe("errorHandler", () => {
  function createTestApp() {
    const app = new Hono();
    app.onError(errorHandler);
    return app;
  }

  it("returns correct JSON for AppError with 404", async () => {
    const app = createTestApp();
    app.get("/test", () => {
      throw new AppError("Resource not found", 404);
    });

    const res = await app.request("/test");
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({ error: "Resource not found" });
  });

  it("returns correct JSON for AppError with 400 and detail", async () => {
    const app = createTestApp();
    app.get("/test", () => {
      throw new AppError("Validation failed", 400, "Email is required");
    });

    const res = await app.request("/test");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({
      error: "Validation failed",
      detail: "Email is required",
    });
  });

  it("returns 500 with generic message for unknown errors", async () => {
    const app = createTestApp();
    app.get("/test", () => {
      throw new Error("something broke");
    });

    const res = await app.request("/test");
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ error: "Internal server error" });
  });

  // D17 / F29 — proper-lockfile (CLAUDE.md rule 6 / DO-NOT #6) throws an
  // Error with code "ELOCKED" on cross-process contention. The ~8
  // store-mutating endpoints that call store.persist() without an inline
  // try/catch (fork, close, create, launch, DELETE, inbox dismiss,
  // settings PUT, project-delete cascade) let it bubble to this global
  // handler, where it must surface as the SAME retryable 409 body the
  // per-route handlers (patch.ts, lifecycle.ts) already emit — not a 500.
  it("maps an ELOCKED error to a retryable 409", async () => {
    const app = createTestApp();
    app.post("/persist", () => {
      const err = new Error("Lock file is already being held") as NodeJS.ErrnoException;
      err.code = "ELOCKED";
      throw err;
    });

    const res = await app.request("/persist", { method: "POST" });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body).toEqual({ error: "sdk-sessions.json is locked, retry" });
  });

  // ELOCKED takes precedence even when the error also looks like an
  // AppError-adjacent shape — the code branch is checked for any non-App
  // error, so a plain Error carrying the code maps to 409, never 500.
  it("prefers the ELOCKED 409 over the generic 500 fallback", async () => {
    const app = createTestApp();
    app.get("/lock", () => {
      const err = new Error("ELOCKED") as NodeJS.ErrnoException;
      err.code = "ELOCKED";
      throw err;
    });

    const res = await app.request("/lock");
    expect(res.status).toBe(409);
  });

  // D17 / F33 — an unguarded `await c.req.json()` (projects POST/PATCH,
  // settings PUT) rejects with a SyntaxError on a malformed or empty body
  // BEFORE any validation runs. It must map to the established 400
  // invalid_json contract (triage.ts, actions/upload.ts), not a 500.
  it("maps a malformed JSON body (SyntaxError) to 400 invalid_json", async () => {
    const app = createTestApp();
    app.post("/body", async (c) => {
      const body = await c.req.json();
      return c.json({ body });
    });

    const res = await app.request("/body", {
      method: "POST",
      body: "{not valid json",
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({ error: "invalid_json" });
  });

  it("maps an empty JSON body (SyntaxError) to 400 invalid_json", async () => {
    const app = createTestApp();
    app.post("/body", async (c) => {
      const body = await c.req.json();
      return c.json({ body });
    });

    const res = await app.request("/body", {
      method: "POST",
      body: "",
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({ error: "invalid_json" });
  });

  // D17 external-review hardening — a SyntaxError that is NOT a body-parse
  // failure (no "JSON" in the message: e.g. a server-side dynamic-regex or
  // Function() defect) must still surface as a truthful 500, never a
  // mislabeled client 400. Guards the narrowed `&& includes("JSON")` branch.
  it("leaves a non-body SyntaxError as a 500, not a 400", async () => {
    const app = createTestApp();
    app.get("/regex", () => {
      throw new SyntaxError("Invalid regular expression: missing terminating ] for character class");
    });

    const res = await app.request("/regex");
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ error: "Internal server error" });
  });

  // D17 external-code-review hardening — the body-parse guard is
  // case-insensitive (/json/i), so a non-V8 adapter that emits a lowercase
  // "json" parse message still maps to 400 rather than regressing to 500.
  it("maps a lowercase-'json' parse SyntaxError to 400 invalid_json", async () => {
    const app = createTestApp();
    app.get("/lower", () => {
      throw new SyntaxError("Unexpected token < in json at position 0");
    });

    const res = await app.request("/lower");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({ error: "invalid_json" });
  });
});
