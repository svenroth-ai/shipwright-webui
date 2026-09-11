/*
 * Torn-read retry (server-side; used by run-config-reader). Split out of
 * run-config-v2.ts — that file is at its bloat ceiling and this section has
 * no dependency on the RunMode/RunConfigV2 types above it. F15.
 */

/**
 * Standard run-config torn-read backoff schedule (ms). The orchestrator writes
 * the config atomically (rename); on Windows the brief rename window can throw
 * EBUSY/EPERM/EACCES or yield a partial JSON parse. The reader retries on this
 * schedule before falling back to its last-good cache.
 */
export const RUN_CONFIG_RETRY_DELAYS_MS: readonly number[] = [50, 150, 450];

const RETRYABLE_FS_CODES = new Set(["EBUSY", "EPERM", "EACCES"]);

/**
 * A torn read is retryable when it is a SyntaxError (partial JSON caught mid
 * write) OR an EBUSY/EPERM/EACCES fs error (Windows rename window). ENOENT is
 * deliberately NOT retryable — a truly-absent file is a stable state.
 */
export function isRetryableTornRead(err: unknown): boolean {
  if (err instanceof SyntaxError) return true;
  const code = (err as NodeJS.ErrnoException | undefined)?.code;
  return Boolean(code && RETRYABLE_FS_CODES.has(code));
}

export type RetryOutcome<T> =
  | { ok: true; value: T }
  | { ok: false; error: unknown };

/**
 * Retry an async fs op on retryable torn-read errors using the standard
 * backoff. Resolves `{ ok:true, value }` on success, or `{ ok:false, error }`
 * once the budget is exhausted or a non-retryable error is hit. Lives next to
 * the RunConfig types (not inline in the reader) because run-config-reader.ts
 * is at its bloat ceiling — same rationale as parseRunMode. F15.
 */
export async function retryTornRead<T>(
  op: () => Promise<T>,
  wait: (ms: number) => Promise<void>,
  delays: readonly number[] = RUN_CONFIG_RETRY_DELAYS_MS,
): Promise<RetryOutcome<T>> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      return { ok: true, value: await op() };
    } catch (err) {
      lastError = err;
      if (!isRetryableTornRead(err) || attempt === delays.length) break;
      await wait(delays[attempt] ?? 0);
    }
  }
  return { ok: false, error: lastError };
}
