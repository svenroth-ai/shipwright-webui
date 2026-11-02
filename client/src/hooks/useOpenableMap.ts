/*
 * useOpenableMap - list-level sibling of useOpenable: probes every path of a list (one batched request,
 * lib/pathProbe) and returns path -> "yes" | "no" | "gone" | "unknown" | "pending". "gone" is a "no" the
 * server explained as `not_found` (the file is not on disk any more): callers hide a row ONLY on "gone".
 * A present-but-unviewable file ("no": not previewable, too large, sensitive, evidence window truncated),
 * a pending probe and an unknown/failed probe all keep the row (fail open). Cached answers age out, so the
 * list re-checks itself on a slow tick instead of keeping a stale answer; an inconclusive re-probe never
 * overwrites a definitive one (no row flapping on a 429).
 */

import { useEffect, useState } from "react";

import { peekGone, peekProbe, probePath, type ProbeAnswer } from "../lib/pathProbe";
import type { Openable } from "./useOpenable";

const RECHECK_MS = 30_050;

export type ListOpenable = Openable | "gone";

export function useOpenableMap(taskId: string | undefined, paths: string[]): Map<string, ListOpenable> {
  const [answers, setAnswers] = useState<Map<string, ProbeAnswer | "gone">>(() => new Map());
  const [tick, setTick] = useState(0);
  const pathsKey = paths.join("\n");

  useEffect(() => {
    if (!taskId) return;
    const t = setInterval(() => setTick((n) => n + 1), RECHECK_MS);
    return () => clearInterval(t);
  }, [taskId]);

  useEffect(() => {
    if (!taskId) return;
    for (const p of pathsKey ? pathsKey.split("\n") : []) {
      if (peekProbe(taskId, p)) continue;
      void probePath(taskId, p).then((a) => {
        const next = a === "no" && peekGone(taskId, p) ? "gone" : a;
        setAnswers((prev) => {
          const key = `${taskId}\u0000${p}`;
          const before = prev.get(key);
          if (before === next || (next === "unknown" && before)) return prev;
          return new Map(prev).set(key, next);
        });
      });
    }
  }, [taskId, pathsKey, tick]);

  const out = new Map<string, ListOpenable>();
  for (const p of paths) {
    if (!taskId) {
      out.set(p, "unknown");
      continue;
    }
    const fresh = peekProbe(taskId, p);
    out.set(p, fresh ? (fresh === "no" && peekGone(taskId, p) ? "gone" : fresh) : (answers.get(`${taskId}\u0000${p}`) ?? "pending"));
  }
  return out;
}
