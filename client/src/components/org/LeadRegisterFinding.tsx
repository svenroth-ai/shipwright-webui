/*
 * LeadRegisterFinding.tsx — the beat-register health finding rendered on
 * the card's Now block (iterate spec FR-04.41: "an open beat-register entry
 * shows a visible finding on the card without opening a modal"). Split out
 * of `LeadCard.tsx` to keep that file under the 300-line convention.
 *
 * Renders `lead.register` VERBATIM from `evaluateRegisterHealth`'s own
 * classification — never a second vocabulary invented client-side. `clear`
 * renders nothing (the steady state); `unknown` (a read failure, see
 * `LeadRegisterView`'s doc comment) is a muted, button-less line — there is
 * nothing to release against a register this code couldn't even read.
 * `fault` (duplicate sessionId) also gets no release button: the server's
 * own `performRelease` REFUSES to act on a duplicate sessionId (409 fault —
 * see `beat-register-release-core.ts`'s "never pick one, never show the
 * newest" comment), so offering a button that is guaranteed to fail would
 * be worse than naming the problem and stopping there. Only `open` gets the
 * release action — the one case FR-04.41 is actually about.
 */
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import type { LeadRegisterView } from "../../lib/orgApi";
import { releaseBeatRegisterEntry } from "../../lib/orgRegisterApi";
import { formatRelativeTime } from "../../lib/formatTime";
import { ApiError } from "../../lib/externalApi";
import { ORG_ROSTER_QUERY_KEY } from "../../hooks/useOrgRoster";

function shortSessionId(sessionId: string): string {
  return sessionId.slice(0, 8);
}

export function LeadRegisterFinding({ leadId, register }: { leadId: string; register: LeadRegisterView }) {
  const queryClient = useQueryClient();
  const [releasing, setReleasing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Code-review fix (medium): `error`/`releasing` must not survive a change
  // in WHICH entry this card is reporting on — a roster refetch can hand
  // this component a different open entry for the same lead (the prior one
  // released, a new beat started), and a stale error from the old entry
  // would misattribute to the new one. Keyed on status+sessionId, the only
  // identity `LeadRegisterView`'s arms carry (`unknown`/`clear` have none,
  // so any transition into/out of those also resets).
  const identityKey =
    register.status === "open"
      ? `open:${register.entry.sessionId}`
      : register.status === "fault"
        ? `fault:${register.sessionId}`
        : register.status;
  // External-review fix (Branch A/GLM, low): reset only `error`, never
  // `releasing`, here. `releasing` already returns to `false` through
  // `handleRelease`'s own `finally` block when ITS request settles — this
  // effect additionally clearing it on identity change would re-enable the
  // button while that request is still in flight (the roster's 5-minute
  // refetch, or the invalidation from a DIFFERENT card, can swap in a new
  // open entry mid-request), letting a click fire a second concurrent
  // release for the new entry before the first resolves.
  useEffect(() => {
    setError(null);
  }, [identityKey]);

  if (register.status === "clear") {
    return null;
  }

  if (register.status === "unknown") {
    return (
      <div className="register-finding muted" data-testid="lead-register-finding" data-register-status="unknown">
        Beat-register status not measured
      </div>
    );
  }

  if (register.status === "fault") {
    return (
      <div className="register-finding attn" data-testid="lead-register-finding" data-register-status="fault">
        Duplicate beat-register entries for session {shortSessionId(register.sessionId)} — release is refused
        until this is resolved manually.
      </div>
    );
  }

  if (register.status !== "open") {
    // Doubt-review fix (low, defense-in-depth): an exhaustiveness guard, not
    // dead code — org-schema-sync.test.ts keeps `LeadRegisterView` and this
    // branch in sync today, but without this check a future 5th status arm
    // would fall through to `register.entry` below as `undefined` and throw
    // deep inside a render, rather than surfacing as a caught type error.
    const _exhaustive: never = register;
    throw new Error(`LeadRegisterFinding: unhandled register status ${JSON.stringify(_exhaustive)}`);
  }
  const { entry } = register;

  async function handleRelease() {
    if (releasing) return;
    const reason = window.prompt(
      "Reason for releasing this beat (recorded in the audit log):",
      "",
    );
    if (reason === null) return; // cancelled
    const trimmed = reason.trim();
    if (trimmed.length === 0) {
      setError("A reason is required to release this beat.");
      return;
    }
    setError(null);
    setReleasing(true);
    try {
      const result = await releaseBeatRegisterEntry(leadId, entry.sessionId, trimmed);
      if (!result.ok) {
        setError(`Could not release: ${result.detail || result.reason}`);
      }
    } catch (err) {
      setError(err instanceof ApiError ? `Could not release: ${err.code}` : "Could not release: unexpected error");
    } finally {
      // External-review fix (Branch A, OpenAI, medium): invalidate on ANY
      // terminal response the server actually returned, not only success —
      // a 404 not-found means someone else already released it (or it
      // vanished), so this card's finding is stale either way and a
      // refetch is what clears it. A locked/fault/forbidden response
      // mutates nothing, so invalidating is harmless there too — cheaper
      // to always refetch than to special-case which failures matter.
      await queryClient.invalidateQueries({ queryKey: ORG_ROSTER_QUERY_KEY });
      setReleasing(false);
    }
  }

  return (
    <div className="register-finding attn" data-testid="lead-register-finding" data-register-status="open">
      <span>
        Beat in progress since {formatRelativeTime(entry.startedAt)} (beat {entry.beatId}) — not reflected
        elsewhere on this card.
      </span>
      <button
        type="button"
        className="register-finding-release"
        data-testid="lead-register-release"
        disabled={releasing}
        onClick={handleRelease}
      >
        {releasing ? "Releasing…" : "Release"}
      </button>
      {error && (
        <div className="register-finding-error" data-testid="lead-register-release-error">
          {error}
        </div>
      )}
    </div>
  );
}
