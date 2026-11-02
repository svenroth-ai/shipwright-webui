/*
 * Decision core of GET /tasks/:id/session-file?path=<asset>&assetOf=<html page>.
 *
 * A rendered HTML page that lives OUTSIDE the project is served only because the session evidences it
 * (access.ts). Its relative images / stylesheets / fonts are NOT individually named in the transcript, so
 * the per-path evidence rule refuses every one of them and the page renders without pictures. This is the
 * one extra link in that chain: an asset is served when
 *   - the owner page itself passes the normal decision (evidenced, not sensitive) and is a .html/.htm file,
 *   - the asset is an image / stylesheet / font (ASSET_MIME_BY_EXTENSION) - never a script, page, text or data file,
 *   - it lies inside the owner's own directory tree, by its lexical path AND by its realpath (a symlink that
 *     leaves the folder is refused), and that folder is not a filesystem root, the home directory or an ancestor of
 *     it, the temp directory, or Desktop / Documents / Downloads / Pictures (a page dropped there must not open a
 *     whole drive / profile to its images),
 *   - no path segment starts with "." (.git, .ssh, .env, hidden folders) and it is not a sensitive location.
 * Existence is disclosed only after the owner's evidence is proven, like the rest of the route. Pure
 * extension + containment checks run before any filesystem access beyond the owner's.
 */

import { realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { WIN_DEVICE, decideSessionFileAccess, MAX_PATH_CHARS, type AccessArgs, type AccessDecision } from "./access.js";
import { isSensitivePath } from "./sensitive.js";

/** Served with `?assetOf=`. A frozen literal on purpose: widening it widens what an evidenced page can read. */
export const ASSET_MIME_BY_EXTENSION: Readonly<Record<string, string>> = Object.freeze({
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  css: "text/plain; charset=utf-8",
  woff: "font/woff",
  woff2: "font/woff2",
});

const deny = (status: 400 | 403 | 404, error: string): AccessDecision => ({ ok: false, status, error });
const BACKSLASH = String.fromCharCode(92);
const HTML_PAGE = /\.html?$/i;

const within = (rel: string): boolean => rel !== "" && rel !== ".." && !rel.startsWith(".." + path.sep) && !path.isAbsolute(rel);

/** Catch-all folders directly under the home directory: a page dropped there must not open everything below it. */
const BROAD_HOME_CHILDREN = new Set(["desktop", "documents", "downloads", "pictures", "onedrive", "dropbox"]);

/**
 * A folder too broad to be "the page's own folder": a filesystem root, the home directory or any ancestor of it
 * (the parent of all user profiles), the temp directory itself, or one of the catch-all folders directly under home.
 */
export function isBroadFolder(dir: string): boolean {
  if (path.parse(dir).root === dir) return true;
  const home = os.homedir();
  const homeFromDir = path.relative(dir, home);
  if (homeFromDir === "" || within(homeFromDir)) return true; // dir is home, or home lies below it
  if (path.relative(dir, os.tmpdir()) === "") return true;
  const fromHome = path.relative(home, dir);
  return within(fromHome) && !fromHome.includes(path.sep) && BROAD_HOME_CHILDREN.has(fromHome.toLowerCase());
}
const hasDotSegment = (rel: string): boolean => rel.split(path.sep).some((seg) => seg.startsWith("."));

/**
 * The owner page's evidence decision is the expensive part (an uncached, process-serialized transcript scan) and a page
 * with many images asks for it once per image. A short-lived memo of POSITIVE decisions, shared by a burst of requests
 * (the in-flight promise is stored, so concurrent requests join it), keeps that to one scan. Evidence in an append-only
 * transcript is never withdrawn; a failed decision is never kept, so the next request re-checks.
 */
const OWNER_TTL_MS = 15_000;
const OWNER_MEMO_MAX = 64;
const ownerMemo = new Map<string, { at: number; decision: Promise<AccessDecision> }>();

function decideOwner(args: AccessArgs & { owner: string; memoKey?: string }): Promise<AccessDecision> {
  const run = () => decideSessionFileAccess({ roots: args.roots, requested: args.owner, findEvidence: args.findEvidence });
  const key = args.memoKey ? `${args.memoKey}\0${args.owner}` : null;
  if (!key) return run();
  const hit = ownerMemo.get(key);
  if (hit && Date.now() - hit.at < OWNER_TTL_MS) return hit.decision;
  const decision = run();
  if (ownerMemo.size >= OWNER_MEMO_MAX) ownerMemo.delete(ownerMemo.keys().next().value as string);
  ownerMemo.set(key, { at: Date.now(), decision });
  void decision.then((d) => {
    if (!d.ok && ownerMemo.get(key)?.decision === decision) ownerMemo.delete(key);
  }, () => ownerMemo.delete(key));
  return decision;
}

/** Test hook: forget every memoized owner decision. */
export function resetOwnerMemo(): void {
  ownerMemo.clear();
}

export async function decideAssetAccess(args: AccessArgs & { owner: string; memoKey?: string }): Promise<AccessDecision> {
  const { requested, owner } = args;
  if (!requested) return deny(400, "path_required");
  if (requested.length > MAX_PATH_CHARS || requested.includes("\0") || owner.length > MAX_PATH_CHARS || owner.includes("\0")) {
    return deny(400, "invalid_path");
  }
  const ext = path.extname(requested).toLowerCase().slice(1);
  if (!Object.hasOwn(ASSET_MIME_BY_EXTENSION, ext)) return deny(403, "asset_type_not_allowed");
  if (!path.isAbsolute(owner) || !HTML_PAGE.test(owner)) return deny(403, "asset_owner_invalid");
  if (!path.isAbsolute(requested)) return deny(403, "asset_outside_page_folder");
  // UNC / device namespaces would reach network shares and raw devices.
  if (process.platform === "win32" && (/^[/\x5c]{2}/.test(requested) || WIN_DEVICE.test(path.win32.basename(requested.replaceAll("/", BACKSLASH))))) {
    return deny(400, "invalid_path");
  }

  // An NTFS alternate data stream (`notes.txt:evil.png`) would pass the extension check: no ':' after the drive letter.
  if (process.platform === "win32" && requested.replace(/^[a-zA-Z]:/, "").includes(":")) return deny(400, "invalid_path");

  const page = await decideOwner(args);
  if (!page.ok) return page;

  const pageDir = path.dirname(page.absolute); // already a realpath
  if (isBroadFolder(pageDir)) return deny(403, "asset_page_folder_too_broad");
  const abs = path.resolve(requested);
  // The requested spelling is the client's lexical one: when the page's folder is reached through a symlink / junction
  // / subst drive it differs from the realpath `pageDir`, so either spelling of the folder may contain it. The
  // authority is the realpath containment below.
  let lexical = path.relative(pageDir, abs);
  if (!within(lexical)) lexical = path.relative(path.dirname(path.resolve(owner)), abs);
  if (!within(lexical)) return deny(403, "asset_outside_page_folder");
  if (hasDotSegment(lexical)) return deny(403, "asset_hidden_path");

  let real: string;
  try {
    real = await realpath(abs);
  } catch {
    return deny(404, "not_found");
  }
  const actual = path.relative(pageDir, real);
  if (!within(actual)) return deny(403, "asset_outside_page_folder");
  if (hasDotSegment(actual) || isSensitivePath(real)) return deny(403, "sensitive_location");
  return { ok: true, absolute: real, scope: "session" };
}
