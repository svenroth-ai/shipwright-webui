/*
 * Orchestrator for GET /tasks/:id/session-info: scans the session JSONL and its
 * `<uuid>/subagents/agent-*.jsonl` siblings (bounded, positional, read-only)
 * and assembles the SessionInfo view.
 *
 * Memo: PER FILE, keyed by (path,size,mtime), with in-flight de-duplication so
 * parallel polls share one scan. A live session therefore rescans only the
 * files that actually changed — finished agent files are free. It is a pure
 * function cache (no byte cursors, same answer on hit and miss), so the
 * transcript route's statelessness (CLAUDE.md rule 4) is untouched; bounded by
 * MEMO_MAX with oldest-first eviction.
 */

import { readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";

import { ENOENT_FATAL, readWithRetry } from "../session-jsonl-io.js";
import type { JsonlLocation } from "../session-watcher.js";
import { ingestLine, newFacts, outputKey, quickTimestamp, type Facts } from "./collect.js";
import { readFirstLine, scanLines, type LineScanResult } from "./line-scan.js";
import { detectRemoteControl, type RemoteControlDeps } from "./remote-control.js";
import { buildSubagents, type SubagentFile } from "./subagents.js";
import type { SessionInfo, SessionOutputFile } from "./types.js";

export const SESSION_SCAN_BYTES = 48 * 1024 * 1024;
export const SUBAGENT_SCAN_BYTES = 12 * 1024 * 1024;
export const MAX_SUBAGENTS = 60;
export const MAX_OUTPUTS = 300;
const MEMO_MAX = 512;
const SCAN_CONCURRENCY = 6;

export interface SessionInfoDeps extends RemoteControlDeps {
  now?: () => number;
  /** Test seam: bypass the per-file memo. */
  noMemo?: boolean;
}

interface Scanned {
  facts: Facts;
  scan: LineScanResult;
}
const memo = new Map<string, { sig: string; p: Promise<Scanned> }>();
/** Test hook: number of real scans performed (memo misses). */
export const scanStats = { scans: 0 };

async function scanFile(file: string, maxBytes: number, agentId: string | null): Promise<Scanned> {
  scanStats.scans++;
  const facts = newFacts();
  const scan = await scanLines(file, maxBytes, (l) => ingestLine(facts, l, agentId));
  if (scan.truncated) {
    // Window skipped the start; recover the true start timestamp from the head.
    const head = await readFirstLine(file).catch(() => null);
    const ts = head ? quickTimestamp(head) : null;
    if (ts) facts.firstTs = ts;
  }
  return { facts, scan };
}

function scanCached(file: string, sig: string, maxBytes: number, agentId: string | null, noMemo?: boolean): Promise<Scanned> {
  if (noMemo) return scanFile(file, maxBytes, agentId);
  const hit = memo.get(file);
  if (hit && hit.sig === sig) {
    memo.delete(file); // LRU: refresh recency on a hit
    memo.set(file, hit);
    return hit.p;
  }
  const p = scanFile(file, maxBytes, agentId);
  memo.delete(file);
  if (memo.size >= MEMO_MAX) memo.delete(memo.keys().next().value as string);
  memo.set(file, { sig, p });
  p.catch(() => {
    if (memo.get(file)?.p === p) memo.delete(file); // never cache a failure
  });
  return p;
}

async function listSubagentFiles(sessionPath: string): Promise<{ files: SubagentFile[]; dropped: number }> {
  const dir = path.join(path.dirname(sessionPath), path.basename(sessionPath, ".jsonl"), "subagents");
  let entries;
  try {
    // Containment (CLAUDE.md DO-NOT #10 style: realpath + path.relative, not startsWith):
    // a junction/symlinked subagents dir must not lead outside the session folder.
    const [realDir, realRoot] = await Promise.all([realpath(dir), realpath(path.dirname(sessionPath))]);
    const rel = path.relative(realRoot, realDir);
    if (rel.startsWith("..") || path.isAbsolute(rel)) return { files: [], dropped: 0 };
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return { files: [], dropped: 0 };
  }
  const out: SubagentFile[] = [];
  for (const e of entries) {
    // Dirent.isFile() is false for symlinks: a link planted in the dir is never followed.
    const m = e.isFile() ? /^agent-([A-Za-z0-9]+)\.jsonl$/.exec(e.name) : null;
    if (!m) continue;
    const jsonlPath = path.join(dir, e.name);
    try {
      const s = await stat(jsonlPath);
      out.push({ agentId: m[1]!, jsonlPath, metaPath: path.join(dir, `agent-${m[1]}.meta.json`), mtimeMs: s.mtimeMs, size: s.size });
    } catch {
      /* vanished between readdir and stat */
    }
  }
  out.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return { files: out.slice(0, MAX_SUBAGENTS), dropped: Math.max(0, out.length - MAX_SUBAGENTS) };
}

export async function readSessionInfo(
  sessionUuid: string,
  loc: JsonlLocation,
  deps: SessionInfoDeps = {},
): Promise<SessionInfo> {
  const now = (deps.now ?? Date.now)();
  const { files: subFiles, dropped } = await listSubagentFiles(loc.path);
  const st = await readWithRetry(() => stat(loc.path), ENOENT_FATAL);
  const main = await scanCached(loc.path, `${st.size}:${st.mtimeMs}`, SESSION_SCAN_BYTES, null, deps.noMemo);
  const subFacts = new Map<string, Facts>();
  let next = 0;
  const worker = async () => {
    for (let k = next++; k < subFiles.length; k = next++) {
      const f = subFiles[k]!;
      try {
        subFacts.set(f.agentId, (await scanCached(f.jsonlPath, `${f.size}:${f.mtimeMs}`, SUBAGENT_SCAN_BYTES, f.agentId, deps.noMemo)).facts);
      } catch {
        /* an unreadable agent file drops that agent's detail, not the whole view */
      }
    }
  };
  // Bounded pool: a cold memo must not open 60 files / hold 60 chunk buffers at once.
  await Promise.all(Array.from({ length: Math.min(SCAN_CONCURRENCY, subFiles.length) }, worker));
  const facts = main.facts;
  const lastCompaction = facts.compactions.length ? facts.compactions[facts.compactions.length - 1]! : null;
  // A compaction newer than the newest usage makes that usage stale: still reported
  // (the spec's definition), flagged, and paired with the compactor's own estimate.
  const compactedSince = !!lastCompaction && lastCompaction.seq > facts.usageSeq;

  const merged = new Map<string, SessionOutputFile>();
  const all = [...facts.outputs.values(), ...[...subFacts.values()].flatMap((sf) => [...sf.outputs.values()])];
  for (const o of all) {
    const key = outputKey(o.path);
    const prev = merged.get(key);
    if (!prev) merged.set(key, { ...o });
    else {
      if (o.firstAt && (!prev.firstAt || o.firstAt < prev.firstAt)) prev.firstAt = o.firstAt;
      if (o.lastAt && (!prev.lastAt || o.lastAt > prev.lastAt)) {
        prev.lastAt = o.lastAt;
        prev.tool = o.tool;
        prev.agentId = o.agentId;
      }
    }
  }
  const sortedAll = [...merged.values()].sort((a, b) => (b.lastAt ?? "").localeCompare(a.lastAt ?? ""));

  const remoteControl = await detectRemoteControl(sessionUuid, facts.bridgeSeen, deps);
  const subagents = await buildSubagents(subFiles, subFacts, facts, now);
  return {
    sessionUuid,
    context: {
      tokens: facts.usage?.tokens ?? null,
      model: facts.usage?.model ?? facts.model,
      at: facts.usage?.at ?? null,
      compactedSince,
      tokensAfterCompaction: compactedSince ? (lastCompaction!.postTokens ?? null) : null,
    },
    compaction: {
      count: facts.compactions.length,
      last: lastCompaction
        ? { at: lastCompaction.at, preTokens: lastCompaction.preTokens, postTokens: lastCompaction.postTokens }
        : null,
    },
    outputs: sortedAll.slice(0, MAX_OUTPUTS),
    remoteControl,
    subagents,
    scan: {
      ...main.scan,
      outputsTruncated: Math.max(0, sortedAll.length - MAX_OUTPUTS),
      subagentsTruncated: dropped,
    },
  };
}
