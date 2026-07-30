/*
 * resync-gate.ts — admission policy for client-requested terminal resyncs
 * (iterate-2026-07-30-terminal-ws-drop-resync, FR-01.28).
 *
 * A resync answers a `{type:"resync"}` frame with a full-grid `replay_snapshot`.
 * That is deliberately cheap for the CLIENT to ask for and NOT cheap for the
 * server to serve: `serializeMirrorIfLive` runs the M2 double-serialize against a
 * warm terminal (ADR-087/092). Unthrottled, a buggy or hostile client could pin a
 * core by spamming the frame, so admission is gated here.
 *
 * Policy, deliberately minimal:
 *   - one resync in flight per connection at a time,
 *   - a floor between two resyncs on the same connection.
 *
 * A denied request is DROPPED, not queued. Queueing would be the wrong shape: the
 * client re-asks on the next backpressure notice, and the episode-END notice
 * (`backpressure-telemetry.ts`) guarantees one such notice arrives after the last
 * drop of an episode — so the final state always gets a resync opportunity without
 * this module holding a queue it would have to invalidate.
 *
 * ADR-103 protects `ws-upgrade-handler.ts` as a deep module and forbids splitting
 * WS-body helpers out of it. This is not such a helper: it is a general admission
 * policy with no WS knowledge, which is the "dedicated neutral module" that ADR
 * explicitly sanctions — and keeping it separate is what makes the policy
 * unit-testable without standing up a WS stack.
 */

/** Floor between two resyncs on one connection. */
export const DEFAULT_RESYNC_MIN_INTERVAL_MS = 1_000;

export interface ResyncGateOpts {
  now?: () => number;
  minIntervalMs?: number;
}

export interface ResyncGate {
  /**
   * @returns `true` when the caller may perform a resync now. On `true` the gate
   *   is marked in-flight and the caller MUST call `release()` when done
   *   (success or failure), or the connection never resyncs again.
   */
  tryAcquire(): boolean;
  /** Mark the in-flight resync finished. Idempotent. */
  release(): void;
  /** Diagnostics: how many requests this gate has turned away. */
  deniedCount(): number;
}

export function createResyncGate(opts: ResyncGateOpts = {}): ResyncGate {
  const now = opts.now ?? (() => Date.now());
  const minIntervalMs = opts.minIntervalMs ?? DEFAULT_RESYNC_MIN_INTERVAL_MS;

  let inFlight = false;
  let lastStartedAt: number | null = null;
  let denied = 0;

  return {
    tryAcquire() {
      if (inFlight) {
        denied += 1;
        return false;
      }
      const t = now();
      if (lastStartedAt !== null && t - lastStartedAt < minIntervalMs) {
        denied += 1;
        return false;
      }
      inFlight = true;
      lastStartedAt = t;
      return true;
    },
    release() {
      inFlight = false;
    },
    deniedCount() {
      return denied;
    },
  };
}
