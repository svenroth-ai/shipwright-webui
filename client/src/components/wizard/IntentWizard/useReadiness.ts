/*
 * useReadiness — reads GET /api/readiness (the server-side First-Contact gate,
 * FR-01.51). "One truth": the same probe A14's First Contact will read. While
 * the fetch is in flight the doors stay INERT (not-ready-until-proven) — a gate
 * that opened during "unknown" would be the very "assume success" failure it
 * exists to prevent.
 */

import { useQuery } from "@tanstack/react-query";

import { useStandaloneView } from "../../../lib/standaloneView";
import type { ReadinessReport } from "./types";

async function fetchReadiness(): Promise<ReadinessReport> {
  const res = await fetch("/api/readiness", { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`readiness ${res.status}`);
  return (await res.json()) as ReadinessReport;
}

/** Checks that only matter for the Shipwright SDLC pipeline — a Standalone-view
 *  user (plain Claude task board) needs neither the plugins nor their cache. */
export const SHIPWRIGHT_ONLY_CHECKS: readonly string[] = ["plugins", "cache"];

/** Server `ready`, recomputed WITHOUT the Shipwright-only checks. The server
 *  keeps the "at least one engine" gate separate from the checks, so derive it
 *  from the claude/codex rows. Fails closed when the report is absent. */
export function readyWithoutPlugins(report: ReadinessReport | undefined): boolean {
  if (!report) return false;
  const ok = (key: string) => report.checks.find((c) => c.key === key)?.ok === true;
  const engineReady = ok("claude") || ok("codex");
  return (
    engineReady &&
    report.checks.every(
      (c) => c.ok || !c.critical || SHIPWRIGHT_ONLY_CHECKS.includes(c.key),
    )
  );
}

export interface ReadinessState {
  /** Standalone view is on: plugins/cache are not required. */
  standalone?: boolean;
  report: ReadinessReport | null;
  /** True only when the probe has returned AND every critical check passed. */
  ready: boolean;
  loading: boolean;
  error: boolean;
}

export function useReadiness(): ReadinessState {
  const q = useQuery<ReadinessReport>({
    queryKey: ["readiness"],
    queryFn: fetchReadiness,
    staleTime: 15_000,
    // The gate errs to not-ready: a failed probe must NOT spin on a retry
    // backoff (during which the doors would sit in an ambiguous "checking"
    // limbo) — show not-ready at once. A transient failure recovers on the next
    // window focus, when we re-probe.
    retry: false,
    refetchOnWindowFocus: true,
  });
  const standalone = useStandaloneView();
  return {
    report: q.data ?? null,
    // Not-ready until the probe proves ready. Loading/error ⇒ doors inert.
    ready: standalone ? readyWithoutPlugins(q.data) : q.data?.ready === true,
    standalone,
    loading: q.isLoading,
    error: q.isError,
  };
}
