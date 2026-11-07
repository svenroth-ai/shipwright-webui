/*
 * events-split.ts — TEST-ONLY port of shipwright `shared/tests/_events_split.py`
 * (the content-only splitter of the S0 unsplit/split fixture pair).
 *
 * Splits ONE legacy event log into per-run drop files by CONTENT alone: the key
 * is `adr_id` else `session` else `_legacy`; records keep their relative order
 * inside each file. Kept byte-for-byte with the Python source — a drift is caught
 * by `event-log-replay.test.ts`, which compares this port's output with the
 * committed `fixtures/events_layout/split/` tree the Python splitter produced.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

export const FIXED_SUFFIX = "--00000000--00000000.jsonl";

export function contentKey(event: Record<string, unknown>): string {
  for (const field of ["adr_id", "session"]) {
    const val = event[field];
    if (typeof val === "string" && val) {
      const key = [...val].map((c) => (/[\p{L}\p{N}]/u.test(c) || "._-".includes(c) ? c : "-")).join("");
      return key.replace(/^\.+/, "").slice(0, 80) || "_legacy";
    }
  }
  return "_legacy";
}

/** Write `<outRoot>/shipwright_events.d/<key>--00000000--00000000.jsonl` files; returns their names. */
export function splitLog(unsplitText: string, outRoot: string): string[] {
  const groups = new Map<string, string[]>();
  for (const raw of unsplitText.split(/\r\n|\n|\r/)) {
    if (!raw.trim()) continue;
    const key = contentKey(JSON.parse(raw) as Record<string, unknown>);
    groups.set(key, [...(groups.get(key) ?? []), raw]);
  }
  const folder = path.join(outRoot, "shipwright_events.d");
  mkdirSync(folder, { recursive: true });
  const names: string[] = [];
  for (const key of [...groups.keys()].sort()) {
    const name = `${key}${FIXED_SUFFIX}`;
    writeFileSync(path.join(folder, name), `${groups.get(key)!.join("\n")}\n`, "utf-8");
    names.push(name);
  }
  return names;
}
