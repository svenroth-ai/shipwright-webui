/*
 * core/pr-status.ts — resolve a GitHub PR's open/merged state for the
 * transcript PrLinkCard (iterate-2026-05-30-pr-card-status, AC3/AC4).
 *
 * This is the ONLY external-network reach in webui. It runs
 *   gh pr view <url> --json state,mergedAt,isDraft
 * with shell:false (the url is a separate argv member — NEVER interpolated
 * into a shell line) AFTER validating it is a github.com pull URL. Results
 * are cached in-memory (60 s TTL) so the 1 s transcript poll does not
 * hammer GitHub. Every failure mode (gh missing / unauth / offline /
 * non-zero exit / malformed json / timeout) collapses to
 * { state: "unknown" }; the card then renders no badge.
 *
 * Security: mirrors the ADR-044 #9 spawn discipline — shell:false, no
 * user string ever reaches a shell. validatePrUrl is the io-boundary gate.
 */

import { execFile, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { platform } from "node:os";

export type PrState = "open" | "merged" | "closed" | "draft" | "unknown";

export interface PrStatus {
  state: PrState;
  merged: boolean;
}

export interface PrUrlParts {
  owner: string;
  repo: string;
  number: number;
}

// https://github.com/<owner>/<repo>/pull/<n>  — owner/repo restricted to
// GitHub-legal path chars; an optional trailing /…, ?…, #… is tolerated.
const PR_URL_RE =
  /^https:\/\/github\.com\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)\/pull\/(\d+)(?:[/?#].*)?$/;

export function validatePrUrl(url: unknown): PrUrlParts | null {
  if (typeof url !== "string" || url.length === 0 || url.length > 400) return null;
  if (url.includes("\0")) return null;
  const m = PR_URL_RE.exec(url);
  if (!m) return null;
  const number = Number.parseInt(m[3], 10);
  if (!Number.isFinite(number) || number <= 0) return null;
  return { owner: m[1], repo: m[2], number };
}

export interface ResolveGhBinDeps {
  platform?: string;
  spawnSync?: typeof spawnSync;
  existsSync?: (p: string) => boolean;
}

/**
 * Resolve an absolute path to the `gh` binary via `where`/`which`
 * (shell:false). Returns null when gh is not on PATH — the caller then
 * degrades to { state: "unknown" }. Unlike the claude CLI (a `.cmd` shim),
 * gh ships as a real `.exe` on Windows, so no shell:true invocation is
 * ever needed.
 */
export function resolveGhBin(deps: ResolveGhBinDeps = {}): string | null {
  const isWin = (deps.platform ?? platform()) === "win32";
  const sync = deps.spawnSync ?? spawnSync;
  const exists = deps.existsSync ?? existsSync;
  try {
    const lookup = isWin ? "where" : "which";
    const r = sync(lookup, ["gh"], { encoding: "utf-8", shell: false });
    if ((r as { error?: unknown }).error) return null;
    const lines = ((r.stdout ?? "") as string)
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .filter((l) => !/^INFO:/i.test(l)); // drop Windows `where`'s not-found notice
    let first = lines[0] ?? null;
    if (isWin) {
      const exe = lines.find((l) => /\.exe$/i.test(l));
      if (exe) first = exe;
    }
    if (first && exists(first)) return first;
    return null;
  } catch {
    return null;
  }
}

export interface GhRunResult {
  exitCode: number;
  stdout: string;
}

export type GhRunner = (bin: string, args: string[]) => Promise<GhRunResult>;

const defaultRunner: GhRunner = (bin, args) =>
  new Promise((resolve) => {
    execFile(
      bin,
      args,
      { timeout: 6000, windowsHide: true, maxBuffer: 1024 * 1024 },
      (err, stdout) => {
        if (err) {
          const code =
            typeof (err as { code?: unknown }).code === "number"
              ? (err as { code: number }).code
              : 1;
          resolve({ exitCode: code, stdout: stdout ?? "" });
        } else {
          resolve({ exitCode: 0, stdout: stdout ?? "" });
        }
      },
    );
  });

export interface FetchPrStatusDeps {
  run?: GhRunner;
  resolveBin?: () => string | null;
  now?: () => number;
  ttlMs?: number;
}

interface CacheEntry {
  status: PrStatus;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();
const DEFAULT_TTL_MS = 60_000;
const CACHE_CAP = 256;

function mapGhJson(raw: string): PrStatus {
  let parsed: { state?: string; mergedAt?: string | null; isDraft?: boolean };
  try {
    parsed = JSON.parse(raw) as typeof parsed;
  } catch {
    return { state: "unknown", merged: false };
  }
  const state = (parsed.state ?? "").toUpperCase();
  if (state === "MERGED" || parsed.mergedAt) {
    return { state: "merged", merged: true };
  }
  if (state === "CLOSED") {
    return { state: "closed", merged: false };
  }
  if (state === "OPEN") {
    return { state: parsed.isDraft ? "draft" : "open", merged: false };
  }
  return { state: "unknown", merged: false };
}

/**
 * Look up (and cache) a PR's open/merged status. `url` MUST already be
 * validated by `validatePrUrl` at the route boundary; this function does
 * not re-validate (it only ever runs gh with the url as a separate argv
 * member, so an unvalidated url cannot inject — but the route gate is the
 * documented contract).
 */
export async function fetchPrStatus(
  url: string,
  deps: FetchPrStatusDeps = {},
): Promise<PrStatus> {
  const now = deps.now ?? Date.now;
  const ttl = deps.ttlMs ?? DEFAULT_TTL_MS;

  const cached = cache.get(url);
  if (cached && cached.expiresAt > now()) {
    return cached.status;
  }

  const bin = (deps.resolveBin ?? (() => resolveGhBin()))();
  let status: PrStatus;
  if (!bin) {
    status = { state: "unknown", merged: false };
  } else {
    const run = deps.run ?? defaultRunner;
    try {
      // `--` end-of-options separator: even though validatePrUrl anchors the
      // url to `https://github.com/…` (so it can never start with `-`), the
      // separator guarantees gh treats the url as the positional <pr> and
      // never as a flag — defense-in-depth if the validator is ever loosened.
      const { exitCode, stdout } = await run(bin, [
        "pr",
        "view",
        "--json",
        "state,mergedAt,isDraft",
        "--",
        url,
      ]);
      status =
        exitCode === 0 ? mapGhJson(stdout) : { state: "unknown", merged: false };
    } catch {
      status = { state: "unknown", merged: false };
    }
  }

  if (cache.size >= CACHE_CAP) cache.clear(); // bounded — local tool, few PRs
  cache.set(url, { status, expiresAt: now() + ttl });
  return status;
}

/** Test-only: reset the module-level TTL cache between cases. */
export function _clearPrStatusCache(): void {
  cache.clear();
}
