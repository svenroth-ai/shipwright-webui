/*
 * useCreateActionParam — consume the palette's `?create=<actionId>` deep link
 * on the board (A21, FR-01.65). The palette "Launch" entries navigate to the
 * board with this param; the board opens the REAL create modal for that action
 * (never a hardcoded slash-command — the action id is matched against the live
 * /actions catalog, DO-NOT #11 / AC9). Ref-guarded so it fires once, then the
 * param is stripped so a reload / back-forward does not re-open the modal.
 */

import { useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import type { ActionDefinition } from "../lib/externalApi";

export function useCreateActionParam(
  actions: ActionDefinition[],
  openModal: (action: ActionDefinition) => void,
): void {
  const [searchParams, setSearchParams] = useSearchParams();
  const consumedRef = useRef(false);

  useEffect(() => {
    if (consumedRef.current) return;
    const id = searchParams.get("create");
    if (!id) return;
    const action = actions.find((a) => a.id === id);
    // Wait until the catalog has loaded; only consume on a real match. An
    // unknown id is silently dropped (honest empty result — no fabricated
    // action, AC9).
    if (actions.length === 0) return;
    consumedRef.current = true;
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("create");
        return next;
      },
      { replace: true },
    );
    if (action) openModal(action);
  }, [actions, openModal, searchParams, setSearchParams]);
}
