/*
 * formatChord — the ONE place a keyboard chord is rendered as text (A21, FR-01.65).
 *
 * THE FENCE — Windows first, both chords always:
 *   Sven is on Windows. A Mac-only `⌘K` hint is WRONG for the primary user.
 *   - Platform detection DEFAULTS TO Windows/Linux (`Ctrl`) when the platform
 *     is unknown — it only returns "mac" on a POSITIVE Mac signal.
 *   - `chordForms()` exposes BOTH the Windows and the Mac string so the
 *     cheat-sheet can print a Windows column AND a Mac column side by side.
 *   - No component hardcodes `⌘` / `Ctrl`; they all route through here.
 */

export type Platform = "mac" | "other";

/**
 * A platform-agnostic chord description. `mod` is Ctrl on Windows/Linux and
 * ⌘ on macOS — the ONE modifier that flips per platform. Everything else is
 * literal.
 */
export interface ChordSpec {
  /** Ctrl (Windows/Linux) ⇄ Cmd (macOS). */
  mod?: boolean;
  shift?: boolean;
  alt?: boolean;
  /** Display key, already human-cased: "K", "?", "Enter", "Esc", "J". */
  key: string;
}

/**
 * Positively detect macOS. Returns "other" (→ Ctrl) for ANY inconclusive
 * signal — never guesses ⌘. SSR-safe (no `navigator` → "other").
 */
export function detectPlatform(): Platform {
  if (typeof navigator === "undefined") return "other";
  // Prefer the modern, high-entropy hint when present; fall back to the
  // legacy (deprecated but still populated) fields.
  const uaData = (
    navigator as unknown as { userAgentData?: { platform?: string } }
  ).userAgentData;
  const candidates = [
    uaData?.platform,
    // navigator.platform is deprecated but still the most reliable Mac tell.
    navigator.platform,
    navigator.userAgent,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.length > 0) {
      // "MacIntel", "Macintosh", "Mac OS X" — all carry "mac".
      if (/mac/i.test(c)) return "mac";
      // A concrete non-Mac signal is enough to stop: default is already Ctrl.
      return "other";
    }
  }
  return "other";
}

const MAC_MOD = "⌘"; // ⌘
const MAC_SHIFT = "⇧"; // ⇧
const MAC_ALT = "⌥"; // ⌥

/** Render a chord for an explicit platform. */
export function formatChordFor(spec: ChordSpec, platform: Platform): string {
  const parts: string[] = [];
  if (platform === "mac") {
    // Apple order: ⌃⌥⇧⌘key, glyphs with no separator.
    if (spec.alt) parts.push(MAC_ALT);
    if (spec.shift) parts.push(MAC_SHIFT);
    if (spec.mod) parts.push(MAC_MOD);
    parts.push(spec.key);
    return parts.join("");
  }
  // Windows / Linux: word modifiers joined with "+".
  if (spec.mod) parts.push("Ctrl");
  if (spec.alt) parts.push("Alt");
  if (spec.shift) parts.push("Shift");
  parts.push(spec.key);
  return parts.join("+");
}

/** Render a chord for the DETECTED platform (defaults to Ctrl when unknown). */
export function formatChord(spec: ChordSpec, platform?: Platform): string {
  return formatChordFor(spec, platform ?? detectPlatform());
}

/** Both platform strings for the cheat-sheet's two columns. */
export function chordForms(spec: ChordSpec): { windows: string; mac: string } {
  return {
    windows: formatChordFor(spec, "other"),
    mac: formatChordFor(spec, "mac"),
  };
}
