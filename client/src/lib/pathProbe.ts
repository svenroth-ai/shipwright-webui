/*
 * pathProbe - client of POST /api/external/tasks/:id/session-file/probe. Answers "can the Viewer open
 * this path?" so a dead path is never presented as a link (chat chips, Outputs rows, terminal links).
 *
 * Calls made in the same tick are coalesced into ONE request (chunks of MAX_BATCH) and every answer is
 * cached per task: a "yes" for a while, a "no" only briefly (the file may be written a moment later).
 * The server stays the authority and answers yes/no only; any failure (network, 429, 5xx, bad shape)
 * resolves to "unknown", which callers treat as openable - the Viewer then reports the real state - and
 * is never cached. Read-only; no content is ever fetched.
 */

import { EXTERNAL_API } from "./externalApi";

export type ProbeAnswer = "yes" | "no" | "unknown";

const MAX_BATCH = 40;
const YES_TTL_MS = 5 * 60_000;
const NO_TTL_MS = 30_000;
const UNKNOWN_BACKOFF_MS = 5_000;
const FETCH_TIMEOUT_MS = 5_000;
const MAX_CACHED_PER_TASK = 2000;

interface Entry {
  answer: "yes" | "no";
  until: number;
  /** A "no" whose server reason is `not_found` (the file is not on disk), as opposed to unviewable-but-present. */
  gone?: boolean;
}
const cache = new Map<string, Map<string, Entry>>();
/** Paths whose last probe failed: not re-asked for a few seconds (keeps a 429 from being hammered). */
const backoff = new Map<string, Map<string, number>>();
const queue = new Map<string, Map<string, Array<(a: ProbeAnswer) => void>>>();
let timer: ReturnType<typeof setTimeout> | null = null;

function taskCache(taskId: string): Map<string, Entry> {
  let m = cache.get(taskId);
  if (!m) cache.set(taskId, (m = new Map()));
  return m;
}

/** Synchronous cache read: the answer if known and fresh, else undefined. */
export function peekProbe(taskId: string, path: string): "yes" | "no" | undefined {
  const e = cache.get(taskId)?.get(path);
  if (!e) return undefined;
  if (e.until <= Date.now()) {
    cache.get(taskId)?.delete(path);
    return undefined;
  }
  return e.answer;
}

/** True only for a fresh "no" the server explained as `not_found`: the file is not on disk any more. */
export function peekGone(taskId: string, path: string): boolean {
  return peekProbe(taskId, path) === "no" && cache.get(taskId)?.get(path)?.gone === true;
}

export function probeUrl(taskId: string): string {
  return `${EXTERNAL_API}/tasks/${encodeURIComponent(taskId)}/session-file/probe`;
}

interface Verdict {
  answer: ProbeAnswer;
  gone: boolean;
}

async function sendBatch(taskId: string, paths: string[]): Promise<Verdict[]> {
  const unknown = (): Verdict[] => paths.map(() => ({ answer: "unknown", gone: false }));
  try {
    const r = await fetch(probeUrl(taskId), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ paths }),
      signal: typeof AbortSignal !== "undefined" && "timeout" in AbortSignal ? AbortSignal.timeout(FETCH_TIMEOUT_MS) : undefined,
    });
    if (!r.ok) return unknown();
    const body = (await r.json()) as { results?: Array<{ openable?: unknown; reason?: unknown }> };
    const results = body.results;
    if (!Array.isArray(results) || results.length !== paths.length) return unknown();
    return results.map((x): Verdict => ({
      answer: x?.openable === true ? "yes" : x?.openable === false ? "no" : "unknown",
      gone: x?.openable === false && x?.reason === "not_found",
    }));
  } catch {
    return unknown();
  }
}

async function flush(): Promise<void> {
  timer = null;
  const jobs = [...queue.entries()];
  queue.clear();
  const work: Array<Promise<void>> = [];
  for (const [taskId, byPath] of jobs) {
    const paths = [...byPath.keys()];
    for (let i = 0; i < paths.length; i += MAX_BATCH) {
      const chunk = paths.slice(i, i + MAX_BATCH);
      work.push(
        sendBatch(taskId, chunk).then((verdicts) => {
          const store = taskCache(taskId);
          if (store.size > MAX_CACHED_PER_TASK) store.clear();
          chunk.forEach((p, k) => {
            const a = verdicts[k]?.answer ?? "unknown";
            if (a === "unknown") {
              let b = backoff.get(taskId);
              if (!b) backoff.set(taskId, (b = new Map()));
              b.set(p, Date.now() + UNKNOWN_BACKOFF_MS);
            } else {
              store.set(p, { answer: a, until: Date.now() + (a === "yes" ? YES_TTL_MS : NO_TTL_MS), gone: verdicts[k]?.gone === true });
            }
            for (const done of byPath.get(p) ?? []) done(a);
          });
        }),
      );
    }
  }
  await Promise.all(work);
}

/** Ask whether `path` (project-relative POSIX, or absolute) is openable for this task. Never rejects. */
export function probePath(taskId: string, path: string): Promise<ProbeAnswer> {
  const known = peekProbe(taskId, path);
  if (known) return Promise.resolve(known);
  if ((backoff.get(taskId)?.get(path) ?? 0) > Date.now()) return Promise.resolve("unknown");
  return new Promise((resolve) => {
    let byPath = queue.get(taskId);
    if (!byPath) queue.set(taskId, (byPath = new Map()));
    const waiters = byPath.get(path);
    if (waiters) waiters.push(resolve);
    else byPath.set(path, [resolve]);
    timer ??= setTimeout(() => void flush(), 0);
  });
}

/** Test seam: forget every cached answer and any queued work. */
export function resetPathProbe(): void {
  cache.clear();
  queue.clear();
  backoff.clear();
  if (timer) clearTimeout(timer);
  timer = null;
}
