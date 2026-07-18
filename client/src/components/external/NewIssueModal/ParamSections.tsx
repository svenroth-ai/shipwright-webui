/*
 * Schema-driven required + advanced parameter sections.
 *
 * Required fields render OUTSIDE the Advanced collapsible (v0.3.0 P2).
 * The Advanced collapsible renders only when there's at least one
 * optional field. ParamField is the per-row primitive (already a
 * sibling under client/src/components/external/).
 */

import { ChevronDown } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";

import { ParamField } from "../ParamField";
import type { RenderableParamSchema } from "../../../types/action-schema";

export interface ParamSectionsProps {
  requiredFields: RenderableParamSchema[];
  advancedFields: RenderableParamSchema[];
  paramValues: Record<string, string | boolean>;
  setParamValues: Dispatch<SetStateAction<Record<string, string | boolean>>>;
  revealedSecrets: Record<string, boolean>;
  setRevealedSecrets: Dispatch<SetStateAction<Record<string, boolean>>>;
  paramEnabled: Record<string, boolean>;
  onParamEnableToggle: (s: RenderableParamSchema) => void;
  advancedOpen: boolean;
  setAdvancedOpen: Dispatch<SetStateAction<boolean>>;
}

export function RequiredParamsFragment(props: ParamSectionsProps) {
  const { requiredFields, paramValues } = props;
  if (requiredFields.length === 0) return null;
  return (
    <div
      data-testid="new-issue-required-section"
      className="flex flex-col gap-3"
    >
      {requiredFields.map((p) => {
        const v = paramValues[p.name];
        const empty =
          (p.type === "boolean" && v !== true) ||
          (p.type !== "boolean" &&
            (typeof v !== "string" || v.trim() === ""));
        return (
          <ParamField
            key={p.name}
            schema={p}
            value={v}
            onChange={(next) =>
              props.setParamValues((prev) => ({ ...prev, [p.name]: next }))
            }
            revealed={props.revealedSecrets[p.name] === true}
            onRevealToggle={() =>
              props.setRevealedSecrets((prev) => ({
                ...prev,
                [p.name]: !prev[p.name],
              }))
            }
            enabled={true}
            showRequiredError={empty}
          />
        );
      })}
    </div>
  );
}

export function AdvancedParamsFragment(props: ParamSectionsProps) {
  const { advancedFields, advancedOpen, setAdvancedOpen } = props;
  if (advancedFields.length === 0) return null;
  return (
    <div
      data-testid="new-issue-advanced-section"
      className="overflow-hidden rounded-[var(--radius-button,8px)] border border-[var(--color-border,#e0dbd4)]"
    >
      <button
        type="button"
        data-testid="new-issue-advanced-toggle"
        onClick={() => setAdvancedOpen((p) => !p)}
        aria-expanded={advancedOpen}
        className="flex w-full items-center justify-between bg-[var(--surface-form-sunken,#e4dfda)] px-3 py-2 text-[12px] font-semibold text-[var(--ink,#1c1917)] hover:bg-[var(--surface-form-sunken-strong,#d9d3cc)]"
      >
        <span>Advanced parameters ({advancedFields.length})</span>
        <ChevronDown
          size={12}
          className={`flex-shrink-0 text-[var(--body,#44403c)] transition-transform ${advancedOpen ? "rotate-180" : ""}`}
        />
      </button>
      {advancedOpen && (
        <div
          data-testid="new-issue-advanced-content"
          className="flex flex-col gap-3 border-t border-[var(--color-border,#e0dbd4)] bg-[var(--color-bg,#f5f0eb)] px-3 py-3"
        >
          {advancedFields.map((p) => (
            <ParamField
              key={p.name}
              schema={p}
              value={props.paramValues[p.name]}
              onChange={(next) =>
                props.setParamValues((prev) => ({ ...prev, [p.name]: next }))
              }
              revealed={props.revealedSecrets[p.name] === true}
              onRevealToggle={() =>
                props.setRevealedSecrets((prev) => ({
                  ...prev,
                  [p.name]: !prev[p.name],
                }))
              }
              enabled={props.paramEnabled[p.name] === true}
              onEnableToggle={() => props.onParamEnableToggle(p)}
              showRequiredError={false}
            />
          ))}
        </div>
      )}
    </div>
  );
}
