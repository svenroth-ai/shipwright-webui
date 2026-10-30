/**
 * Answered AskUserQuestion, desktop-app style (campaign mission-desktop-style,
 * M5): one read-only card per question, its options listed and the CHOSEN
 * answer highlighted. A single-select answer matching no option label is the
 * "Other" free-text answer; a multiSelect answer is shown as its raw text
 * (the encoding is unverified). Display only — no input, no composer
 * (ADR-034). Colours come from the surrounding `.mc-op` token scope, so the
 * cards stay legible on the dark on-photo ground.
 */
import { useId } from "react";
import type { AskItem } from "../../../lib/missionAskItems";
import { CheckIcon } from "./MissionFeedIcons";

export function AskAnswerCards({ items }: { items: AskItem[] }) {
  const uid = useId();
  return (
    <div className="mc-ask" data-testid="mission-ask-cards">
      {items.map((item, index) => (
        <section className="mc-ask-card" data-testid="mission-ask-card" key={item.question}>
          {item.header && <span className="mc-ask-header">{item.header}</span>}
          <p className="mc-ask-question" id={`${uid}-q-${index}`}>{item.question}</p>
          {item.options.length > 0 && (
            <ul className="mc-ask-options" aria-labelledby={`${uid}-q-${index}`}>
              {item.options.map((option) => {
                const chosen = item.chosen === option.label || Boolean(item.chosenAll?.includes(option.label));
                return (
                  <li key={option.label} className="mc-ask-opt" data-testid="mission-ask-option" data-chosen={chosen ? "true" : undefined}>
                    <span className="mc-ask-opt-mark" aria-hidden="true">{chosen && <CheckIcon strokeWidth={2.5} />}</span>
                    <span className="mc-ask-opt-body">
                      <span className="mc-ask-opt-label">{option.label}{chosen && <span className="sr-only"> (selected)</span>}</span>
                      {option.description && <span className="mc-ask-opt-desc">{option.description}</span>}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          {item.other && (
            <div className="mc-ask-answer" data-testid="mission-ask-other" data-chosen="true">
              <span className="mc-ask-opt-mark" aria-hidden="true"><CheckIcon strokeWidth={2.5} /></span>
              <span className="mc-ask-opt-body">
                <span className="mc-ask-opt-desc">Other</span>
                <span className="mc-ask-opt-label">{item.answer}<span className="sr-only"> (selected)</span></span>
              </span>
            </div>
          )}
          {item.notes && <p className="mc-ask-note" data-testid="mission-ask-note">Note: {item.notes}</p>}
          {item.multiSelect && item.answer !== undefined && (
            <div className="mc-ask-answer" data-testid="mission-ask-multi-answer">
              <span className="mc-ask-opt-body">
                <span className="mc-ask-opt-desc">Answer</span>
                <span className="mc-ask-opt-label">{item.answer}</span>
              </span>
            </div>
          )}
        </section>
      ))}
    </div>
  );
}
