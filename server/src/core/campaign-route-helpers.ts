/*
 * campaign-route-helpers.ts — shared helpers for the Campaigns routes.
 *
 * Extracted from `routes/campaigns.ts` so the `start` and `dismiss`/`restore`
 * write endpoints share one copy of the lock-failure classification (mirrors
 * triage.ts / ADR-106) and the route file stays under the 300-LOC ceiling.
 */

import type { Context } from "hono";

/** True for a proper-lockfile contention error (retries exhausted). */
export function isElockedError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: unknown }).code === "ELOCKED"
  );
}

/** 503 body for a contended campaign lock — the client retries. */
export function lockUnavailable(c: Context) {
  return c.json(
    {
      error: "lock_unavailable",
      message: "Campaign storage is busy — please retry in a moment.",
    },
    503,
  );
}

/** Release a held lock, swallowing (warn-logging) a release failure. */
export async function releaseQuietly(release: () => Promise<void>): Promise<void> {
  try {
    await release();
  } catch (err) {
    console.warn(
      JSON.stringify({
        level: "warn",
        message: "campaign route: lock release failed (ignored)",
        error: String(err).slice(0, 200),
      }),
    );
  }
}

/**
 * Guard a campaign slug used as a dismissed-state map key (not a filesystem
 * path — dismiss/restore never touch the campaign dir, which may not exist for
 * a derivedFromEvents ghost). Rejects empty, over-long, and any input bearing a
 * C0 control char or a path separator, so a malformed param can't poison the
 * webui-owned state file.
 */
export function isValidCampaignSlug(slug: string): boolean {
  if (typeof slug !== "string" || slug.length === 0 || slug.length > 200) return false;
  for (let i = 0; i < slug.length; i++) {
    const code = slug.charCodeAt(i);
    if (code < 0x20 || code === 0x2f || code === 0x5c) return false; // C0, '/', '\'
  }
  return true;
}
