/*
 * useReadiness — reads GET /api/readiness (the server-side First-Contact gate,
 * FR-01.51). "One truth": the same probe A14's First Contact will read. While
 * the fetch is in flight the doors stay INERT (not-ready-until-proven) — a gate
 * that opened during "unknown" would be the very "assume success" failure it
 * exists to prevent.
 */

import { useQuery } from "@tanstack/react-query";

import type { ReadinessReport } from "./types";

async function fetchReadiness(): Promise<ReadinessReport> {
  const res = await fetch("/api/readiness", { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`readiness ${res.status}`);
  return (await res.json()) as ReadinessReport;
}

export interface ReadinessState {
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
  return {
    report: q.data ?? null,
    // Not-ready until the probe proves ready. Loading/error ⇒ doors inert.
    ready: q.data?.ready === true,
    loading: q.isLoading,
    error: q.isError,
  };
}
