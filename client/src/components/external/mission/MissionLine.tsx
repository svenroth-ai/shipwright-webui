/*
 * MissionLine — the Operation card's one plain-language sentence (FR-01.56, A12).
 *
 * EVERY word comes from A10's narrator (narrateMission): the lead sentence + the
 * bolded consequence clause. This component owns NO copy — it does not hand-write
 * a second phrase book and it never hardcodes a phase name or slash-command
 * (DO-NOT #11). Honest degradation lives in the narrator: an absent count is
 * simply dropped, so the emphasis clause can be empty (then no bold renders).
 */

import { narrateMission, type MissionInput } from "../../../lib/narrator";

interface Props {
  input: MissionInput;
}

export function MissionLine({ input }: Props) {
  const { text, emphasis } = narrateMission(input);
  return (
    <p className="mc-missionline" data-testid="mission-line">
      {text}
      {emphasis ? (
        <>
          {" "}
          <b>{emphasis}</b>
        </>
      ) : null}
    </p>
  );
}
