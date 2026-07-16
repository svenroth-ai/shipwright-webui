/*
 * RepoPicker — step 1 for BOTH adopt and grade (A08). Grade accepts a folder OR
 * a GitHub URL and says so plainly (a URL costs a shallow clone + network); adopt
 * points at a local folder. One component, parameterised by door.
 */

import { Eye, Target } from "lucide-react";

import { RECENT_PATHS } from "./stubData";
import { StepDots } from "./StepDots";
import { WzPrimary, WzOutline } from "./buttons";
import type { WizardAction } from "./wizardState";
import type { WizardDoor } from "./types";

export function RepoPicker({
  door,
  path,
  dispatch,
}: {
  door: WizardDoor;
  path: string | null;
  dispatch: (a: WizardAction) => void;
}) {
  const grade = door === "grade";
  const target = path?.trim() ?? "";
  return (
    <div className="wz-left" data-testid={`wizard-pick-${door}`}>
      <StepDots total={3} current={0} />
      <h2 className="wz-q">{grade ? "Which repo should I grade?" : "Where does the repo live?"}</h2>
      <div className="wz-hint">
        {grade
          ? "A folder on your machine, or a GitHub URL — both work. A URL is shallow-cloned to a temp folder and deleted right after. Read-only either way: no account, nothing installed, nothing written."
          : "Point me at the folder. I read your code and your history first, and learn your rules before I change anything."}
      </div>
      <input
        className="wz-input wz-line"
        data-testid="wizard-repo-input"
        placeholder={grade ? "A folder, or github.com/…" : "C:\\path\\to\\your-repo"}
        value={path ?? ""}
        onChange={(e) => dispatch({ t: "setPath", path: e.target.value })}
      />
      <div className="wz-chips">
        {RECENT_PATHS.map((c) => (
          <button
            type="button"
            key={c}
            className="wz-chip mono"
            data-testid="wizard-repo-chip"
            onClick={() => dispatch({ t: "startWork", path: c })}
          >
            {c}
          </button>
        ))}
      </div>
      <div className="wz-foot">
        <WzOutline data-testid="wizard-back" onClick={() => dispatch({ t: "back" })}>
          Back
        </WzOutline>
        <WzPrimary
          data-testid="wizard-repo-go"
          disabled={target.length === 0}
          onClick={() => target.length > 0 && dispatch({ t: "startWork", path: target })}
        >
          {grade ? (
            <>
              <Target size={15} /> Grade it
            </>
          ) : (
            <>
              <Eye size={15} /> Read the repo
            </>
          )}
        </WzPrimary>
      </div>
    </div>
  );
}
