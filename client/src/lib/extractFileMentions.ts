/*
 * extractFileMentions.ts — recognizes file-path-like tokens inside free-text
 * triage messages (compliance findings cite files inline, e.g. "see
 * architecture.md" or "client/src/pages/TaskBoardPage.tsx"), so the caller
 * can render them as clickable links into the file viewer. Text recognition
 * only — no I/O, no path-guard call (that happens server-side when the
 * viewer actually opens the path).
 */

// Kept in sync with SmartViewer's own viewable extensions (resolveKind in
// ../components/external/SmartViewer.tsx) by extractFileMentions.viewable.test.ts —
// a mention that SmartViewer can't render is a link to a dead end. Exported
// so that test imports the real list rather than a second hand-copy of it.
export const RECOGNIZED_EXTENSIONS = [
  "tsx",
  "ts",
  "jsx",
  "js",
  "mjs",
  "cjs",
  "py",
  "md",
  "json",
  "yaml",
  "yml",
  "toml",
  "sh",
  "css",
  "html",
];

// A path segment: word chars, dashes, dots (for dotfiles/hidden dirs like
// ".shipwright"), chained across "/" — ending in one of the recognized
// extensions. The alternation order does not matter (the trailing boundary
// below is what stops a short extension like "js" from matching inside
// ".json" — "js" would need to be followed by "on", which the boundary
// rejects). Bounded on both sides by a non-path character so it never
// grabs a leading "(", which is also what keeps a semver string
// ("v0.14.0") or a bare commit SHA (no extension in the list) from
// matching. Case-insensitive: SmartViewer's own dispatch lowercases the
// extension too.
const MENTION_RE = new RegExp(
  `(?<![\\w./-])([\\w.-]+(?:\\/[\\w.-]+)*\\.(?:${RECOGNIZED_EXTENSIONS.join("|")}))(?!\\.?[\\w/-])`,
  "gi",
);

// A scheme-less host + path (e.g. "example.com/readme.md", seen in the wild
// alongside triage file references) would otherwise pass MENTION_RE — its
// first "/"-segment ends in a real recognized extension too. A scheme-
// prefixed URL ("https://example.com/...") never reaches here: the char
// before its host is "/", which MENTION_RE's own lookbehind already
// rejects as a match start. Reject only the segment shape, not the
// extension, so a genuine dotfile/hidden-dir first segment (".shipwright")
// is unaffected — it never matches this pattern (leading dot isn't
// `[\w-]`).
const BARE_DOMAIN_RE = /^[\w-]+(?:\.[\w-]+)*\.(?:com|org|net|io|dev|app|co|gov|edu|ai)$/i;

export interface FileMention {
  start: number;
  end: number;
  path: string;
}

export function extractFileMentions(text: string | null | undefined): FileMention[] {
  if (!text) return [];
  const mentions: FileMention[] = [];
  for (const match of text.matchAll(MENTION_RE)) {
    const path = match[1];
    const slash = path.indexOf("/");
    if (slash !== -1 && BARE_DOMAIN_RE.test(path.slice(0, slash))) continue;
    const start = match.index ?? 0;
    mentions.push({ start, end: start + path.length, path });
  }
  return mentions;
}
