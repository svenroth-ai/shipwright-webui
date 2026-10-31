/*
 * Defence in depth for the session-file route: even a path the session
 * evidences is never served when it lives in a credential-bearing location.
 * The extension allowlist (MIME_BY_EXTENSION) already refuses most key
 * material; this list covers the text-shaped secrets that slip through it.
 * Applied ONLY to files outside the project (project files keep the Smart
 * Viewer's existing behaviour).
 */

const DENIED_DIRS = new Set([".ssh", ".gnupg", ".aws", ".kube", ".azure", ".docker", ".git"]);
const DENIED_NAMES = new Set([".npmrc", ".netrc", ".pypirc", ".git-credentials", ".credentials.json", "credentials", "known_hosts", "authorized_keys"]);
const KEY_NAME = /^id_(rsa|dsa|ecdsa|ed25519)/;

/** True when `absolute` (any separator style, any case) names a credential-bearing location. */
export function isSensitivePath(absolute: string): boolean {
  const parts = absolute
    .replaceAll("\x5c", "/")
    .split("/")
    .filter((s) => s.length > 0)
    .map((s) => s.toLowerCase());
  if (parts.length === 0) return true;
  const base = parts[parts.length - 1]!;
  if (base.startsWith(".env") || base.endsWith(".env")) return true;
  if (DENIED_NAMES.has(base) || KEY_NAME.test(base)) return true;
  return parts.slice(0, -1).some((seg) => DENIED_DIRS.has(seg));
}
