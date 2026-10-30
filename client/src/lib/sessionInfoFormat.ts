/*
 * sessionInfoFormat — pure display helpers for the Mission right sidebar (M3).
 * No percentage anywhere: the server records no context-window size, so only the
 * raw token count + model are ever shown.
 */

/** 1234 -> "1.2k", 1_250_000 -> "1.25M"; whole numbers below 1000. */
export function formatTokens(n: number): string {
  if (n < 1000) return String(Math.round(n));
  if (n < 999_500) {
    const k = n / 1000;
    return `${k >= 100 ? Math.round(k) : Math.round(k * 10) / 10}k`;
  }
  return `${Math.round((n / 1_000_000) * 100) / 100}M`;
}

/** "claude-opus-4-7-20260101" -> "claude-opus-4-7" (drop a trailing date stamp). */
export function shortModel(model: string): string {
  return model.replace(/-\d{8}$/, "");
}

function norm(p: string): string {
  return p.replace(/\\/g, "/").replace(/\/+$/, "");
}

/**
 * Project-root-relative POSIX path of `abs` when it lives under `cwd`, else
 * null (such a file cannot be opened by the project-scoped Smart Viewer).
 * Case-insensitive prefix match only for drive-letter (Windows) paths.
 */
export function relativeToCwd(abs: string, cwd: string): string | null {
  const a = norm(abs);
  const c = norm(cwd);
  // "/" normalises to "" and "C:/" to "C:": legitimate roots, unlike an empty cwd.
  if (!c && !/^[\\/]+$/.test(cwd)) return null;
  const windows = /^[a-zA-Z]:(\/|$)/.test(c);
  const head = a.slice(0, c.length);
  const same = windows ? head.toLowerCase() === c.toLowerCase() : head === c;
  if (!same || a.charAt(c.length) !== "/") return null;
  const rel = a.slice(c.length + 1);
  // Traversal never reaches the viewer (the server path guard stays the authority).
  if (!rel || rel.split("/").some((seg) => seg === ".." || seg === ".")) return null;
  return rel;
}

export function baseName(p: string): string {
  const n = norm(p);
  const i = n.lastIndexOf("/");
  return i >= 0 ? n.slice(i + 1) : n;
}
