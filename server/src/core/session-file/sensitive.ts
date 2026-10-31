/*
 * Defence in depth for the session-file route: a path that lives in a
 * credential-bearing location is refused even when the session evidences it.
 * The extension allowlist (MIME_BY_EXTENSION) already refuses most key
 * material; these lists cover the text-shaped secrets that slip through it.
 *
 *   "project" scope  — a SMALL list of unmistakable secret names, checked on
 *                      the project-relative path (so ordinary project files such
 *                      as locales/en/auth.json or .vscode/mcp.json keep working).
 *   "outside" scope  — the broad list: a file outside the project is only ever
 *                      served on session evidence, so false positives are cheap.
 * Best-effort blocklist, not a boundary: the evidence gate is the boundary.
 */

type Scope = "project" | "outside";

const PROJECT_DIRS = new Set([".ssh", ".gnupg", ".aws"]);
const PROJECT_NAMES = new Set([".npmrc", ".netrc", ".pypirc", ".git-credentials", ".credentials.json", ".claude.json", "known_hosts", "authorized_keys"]);

const OUTSIDE_DIRS = new Set([
  ...PROJECT_DIRS, ".kube", ".azure", ".docker", ".git", "gh", "gcloud", "terraform.d", ".vault", ".config", ".cargo", ".m2",
  "configstore", ".vercel", ".netlify", ".supabase", "github cli", ".pulumi", ".codex", ".gemini", ".wrangler", ".fly",
]);
const OUTSIDE_NAMES = new Set([
  ...PROJECT_NAMES, "credentials", ".vault-token", "hosts.yml", "application_default_credentials.json", "credentials.tfrc.json",
  "mcp.json", "credentials.toml", "auth.json", ".yarnrc.yml", "ngrok.yml", "kaggle.json", "oauth_creds.json", "settings.local.json", "token.json", "secrets.json", "secret.json", "consolehost_history.txt", "serviceaccount.json",
]);
const KEY_NAME = /^id_(rsa|dsa|ecdsa|ed25519)/;
// Cloud / OAuth credential files with variable names (service-account-prod.json, client_secret_123.json, *-adminsdk-*.json).
const CRED_JSON = /^(service[-_]?account.*|client[-_]secret.*|.*-adminsdk-.*)\.json$/;

/** True when `p` (any separator style, any case) names a credential-bearing location in `scope`. */
export function isSensitivePath(p: string, scope: Scope = "outside"): boolean {
  const parts = p
    .replaceAll("\x5c", "/")
    .split("/")
    .filter((s) => s.length > 0)
    .map((s) => s.toLowerCase());
  if (parts.length === 0) return scope === "outside";
  const base = parts[parts.length - 1]!;
  const dirs = parts.slice(0, -1);
  if (base.startsWith(".env") || base.endsWith(".env")) return true;
  if (KEY_NAME.test(base) || (scope === "outside" && CRED_JSON.test(base))) return true;
  // .git/config can carry a token in a remote URL or an extraheader; the rest of .git stays ordinary in project scope.
  if (scope === "project" && (base === "config" || base === "config.worktree") && dirs.includes(".git")) return true;
  if ((scope === "project" ? PROJECT_NAMES : OUTSIDE_NAMES).has(base)) return true;
  if (dirs.some((seg) => (scope === "project" ? PROJECT_DIRS : OUTSIDE_DIRS).has(seg))) return true;
  // Claude's own settings carry env blocks with API keys.
  return scope === "outside" && dirs.includes(".claude") && base.startsWith("settings");
}
