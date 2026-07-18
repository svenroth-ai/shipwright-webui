/*
 * ArtifactLink — one node of the context-driven artifact rail (CONTRACT §6/§8).
 *
 * Sibling of `RecordNode` (which keeps serving scenarios 1/3/4/5 unchanged);
 * this one renders an `ArtifactDescriptor` with the FIVE-state model. It reuses
 * the `rec-node` class family so the two rails are visually identical — the
 * difference is semantic, not cosmetic.
 *
 * Two states render but do NOT open: `unavailable` and `error` are non-clickable
 * and say so in words. That is the honest middle ground between showing a
 * working link to a document we cannot read and hiding the artifact entirely
 * (which would read as "this never existed").
 *
 * Typography hierarchy (§8, ships in Slice 1): label and receipt are distinct
 * elements with distinct weights; the state word is always present for screen
 * readers so state never rides colour alone.
 */

import type { ArtifactDescriptor } from "../../../lib/missionContextApi";
import { artifactStateWord, isArtifactClickable } from "../../../lib/missionArtifacts";

interface Props {
  artifact: ArtifactDescriptor;
  active: boolean;
  onClick: () => void;
}

export function ArtifactLink({ artifact, active, onClick }: Props) {
  const clickable = isArtifactClickable(artifact);
  const stateWord = artifactStateWord(artifact.state);
  // `done` / `pending` map onto the existing rail dot vocabulary so the two
  // rails share one visual language.
  const dotState = artifact.state === "available" ? "done" : "pending";

  const body = (
    <>
      <span className="rn-dot" aria-hidden="true" />
      <span className="rn-body">
        <span className="rn-k">{artifact.label}</span>
        <span className="sr-only"> — {stateWord}</span>
        {artifact.receipt ? <span className="rn-r">{artifact.receipt}</span> : null}
        {!clickable && artifact.note ? <span className="rn-r">{artifact.note}</span> : null}
      </span>
      {clickable ? (
        <span className="rn-go" aria-hidden="true">
          ›
        </span>
      ) : null}
    </>
  );

  // A non-clickable artifact is NOT a disabled button — it is not an action at
  // all, so it renders as static text rather than something focusable that does
  // nothing when pressed.
  if (!clickable) {
    return (
      <p
        className={`rec-node ${dotState} is-inert`}
        data-testid={`artifact-link-${artifact.kind}`}
        data-state={artifact.state}
        aria-label={`${artifact.label}, ${stateWord}`}
      >
        {body}
      </p>
    );
  }

  return (
    <button
      type="button"
      id={`artifact-link-${artifact.kind}`}
      className={`rec-node ${dotState}${active ? " active" : ""}`}
      onClick={onClick}
      aria-label={`${artifact.label}, ${stateWord}${artifact.receipt ? ` — ${artifact.receipt}` : ""}`}
      data-testid={`artifact-link-${artifact.kind}`}
      data-state={artifact.state}
    >
      {body}
    </button>
  );
}
