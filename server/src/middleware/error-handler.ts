import type { ErrorHandler } from "hono";

export class AppError extends Error {
  readonly statusCode: number;
  readonly detail?: string;

  constructor(message: string, statusCode: number, detail?: string) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.detail = detail;
  }
}

export const errorHandler: ErrorHandler = (err, c) => {
  if (err instanceof AppError) {
    const body: { error: string; detail?: string } = {
      error: err.message,
    };
    if (err.detail) {
      body.detail = err.detail;
    }
    console.error(
      JSON.stringify({
        level: "error",
        error: err.message,
        statusCode: err.statusCode,
        detail: err.detail,
      })
    );
    return c.json(body, err.statusCode as 400);
  }

  // F29 (CLAUDE.md rule 6 / DO-NOT #6) — proper-lockfile signals genuine
  // cross-process contention on a multi-writer state file with code
  // "ELOCKED". The ~8 store-mutating endpoints that call store.persist()
  // WITHOUT an inline try/catch (fork, close, create, launch, DELETE task,
  // inbox dismiss, settings PUT, project-delete cascade) let it bubble to
  // here. Surface it as the SAME retryable 409 body the per-route handlers
  // (external/tasks/patch.ts, lifecycle.ts backlog/reopen/column) already
  // emit — an opaque 500 hid a lock that the client should just retry.
  // Those per-route handlers still short-circuit first, so their pinned
  // contracts are untouched.
  if ((err as NodeJS.ErrnoException | undefined)?.code === "ELOCKED") {
    console.error(
      JSON.stringify({
        level: "warn",
        error: "ELOCKED",
        statusCode: 409,
      })
    );
    return c.json({ error: "sdk-sessions.json is locked, retry" }, 409);
  }

  // F33 — an unguarded `await c.req.json()` (routes/projects.ts POST+PATCH,
  // routes/settings.ts PUT) rejects with a SyntaxError on a malformed or
  // empty request body BEFORE any validation runs. Map it to the
  // established 400 invalid_json contract (routes/triage.ts,
  // external/actions/upload.ts) instead of a 500. Every server-side
  // JSON.parse in a handler is try/catch-guarded (settings.ts, upload.ts),
  // so today the only SyntaxError reaching this handler is a body parse
  // failure — but we additionally gate on the message carrying "json"
  // (case-insensitive: V8's JSON.parse errors always do — "Unexpected end
  // of JSON input", "... in JSON at position N" — and the /i guard stays
  // robust to any non-V8 adapter that lowercases it) so a future/library
  // server-side SyntaxError (regex, dynamic Function) still surfaces as a
  // truthful 500 instead of being mislabeled a client 400 (external-review
  // D17).
  if (err instanceof SyntaxError && /json/i.test(err.message)) {
    console.error(
      JSON.stringify({
        level: "error",
        error: "invalid_json",
        statusCode: 400,
        detail: err.message,
      })
    );
    return c.json({ error: "invalid_json" }, 400);
  }

  console.error(
    JSON.stringify({
      level: "error",
      error: err instanceof Error ? err.message : "Unknown error",
      stack: err instanceof Error ? err.stack : undefined,
    })
  );
  return c.json({ error: "Internal server error" }, 500);
};
