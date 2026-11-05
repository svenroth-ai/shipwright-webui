/*
 * Readable, shell-safe task identifiers for command-template placeholders
 * `{task.slug}` and `{task.short_id}` (e.g. `claude -w wt-{task.slug}-{task.short_id}`).
 *
 * SECURITY: both values are substituted UNQUOTED (like `{task.uuid}`), so the
 * slug MUST be strictly `[a-z0-9-]` — anything else would be a shell-injection
 * vector via the user-controlled title. `slugifyTitle` guarantees that by
 * construction: every character outside `[a-z0-9]` becomes "-".
 */

export const SLUG_MAX_LENGTH = 30;
export const SLUG_FALLBACK = "task";
export const SHORT_ID_LENGTH = 6;

const TRANSLITERATIONS: Readonly<Record<string, string>> = {
  ä: "ae",
  ö: "oe",
  ü: "ue",
  ß: "ss",
};

/** Lowercase `[a-z0-9-]` slug of a task title; never empty, never edge-dashed. */
export function slugifyTitle(title: string): string {
  const slug = title
    .normalize("NFC") // decomposed umlauts (macOS input) → precomposed
    .toLowerCase()
    .replace(/[äöüß]/g, (c) => TRANSLITERATIONS[c] ?? "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .slice(0, SLUG_MAX_LENGTH)
    .replace(/-+$/, "");
  return slug || SLUG_FALLBACK;
}

/** First 6 characters of the task UUID. */
export function shortTaskId(uuid: string): string {
  return uuid.slice(0, SHORT_ID_LENGTH);
}
