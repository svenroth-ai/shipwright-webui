/*
 * useOpenable - React side of lib/pathProbe: "yes" | "no" while known, "pending" while the batched
 * probe is in flight, "unknown" when there is nothing to ask (no task, no path) or the probe failed
 * (callers treat unknown as openable: the Viewer reports the real state).
 */

import { useEffect, useState } from "react";

import { peekProbe, probePath, type ProbeAnswer } from "../lib/pathProbe";

export type Openable = ProbeAnswer | "pending";

export function useOpenable(taskId: string | undefined, path: string | undefined): Openable {
  const known = taskId && path ? peekProbe(taskId, path) : undefined;
  const [asked, setAsked] = useState<{ key: string; answer: ProbeAnswer; at: number } | null>(null);
  const key = taskId && path ? `${taskId}\u0000${path}` : "";
  // A remembered answer ages out like the cache does, so a long-lived row re-checks instead of keeping a stale 'no'.
  const stale = asked?.key === key && asked.answer !== "unknown" && Date.now() - asked.at > 30_000;
  // A "no" re-checks by itself after its TTL even if nothing else re-renders the row (the file may be written later).
  const [, setTick] = useState(0);
  useEffect(() => {
    if (asked?.key !== key || asked.answer !== "no") return;
    const t = setTimeout(() => setTick((n) => n + 1), Math.max(0, asked.at + 30_000 - Date.now()) + 50);
    return () => clearTimeout(t);
  }, [asked, key]);
  useEffect(() => {
    if (!taskId || !path || known) return;
    let live = true;
    void probePath(taskId, path).then((answer) => {
      if (live) setAsked({ key, answer, at: Date.now() });
    });
    return () => {
      live = false;
    };
  }, [taskId, path, known, key, stale]);
  if (!taskId || !path) return "unknown";
  if (known) return known;
  return asked?.key === key ? asked.answer : "pending";
}
