/**
 * CappedBody - caps a long block at a fixed height with a fade and a
 * "Show more" / "Show less" toggle (hand-back / subrunner reports can run to
 * hundreds of lines). The content is rendered EXACTLY as before (children
 * untouched); only the box around it is clipped. The toggle appears ONLY when
 * the content really exceeds the cap, so a short report looks and behaves as
 * it always did.
 *
 * Reduced motion: no transition at all - the expanded state is the final state
 * and everything is present in the DOM either way (clipping is visual).
 */
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

export function CappedBody({ children, className, testId }: { children: ReactNode; className?: string; testId?: string }) {
  const clip = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [overflows, setOverflows] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const id = useId();

  useEffect(() => {
    const c = clip.current;
    const i = inner.current;
    if (!c || !i) return;
    // Only meaningful while capped: an expanded box is as tall as its content.
    const measure = () => { if (!expanded) setOverflows(i.offsetHeight > c.clientHeight + 1); };
    measure();
    if (typeof ResizeObserver === "undefined") return; // no observer (old engines/jsdom): the one-shot measure above stands
    const ro = new ResizeObserver(measure);
    ro.observe(i);
    return () => ro.disconnect();
  }, [expanded]); // the observer covers content changes

  return (
    <div className={className} data-testid={testId}>
      <div
        ref={clip}
        id={id}
        className="mc-cap"
        data-cap={expanded ? undefined : "on"}
        data-fade={overflows && !expanded ? "on" : undefined}
        // A keyboard user tabbing into the clipped part would scroll an invisible box: open it instead.
        onFocus={() => { if (overflows) setExpanded(true); }}
      >
        <div ref={inner} className="mc-cap-inner">{children}</div>
      </div>
      {overflows && (
        <button
          type="button"
          className="mc-feed-expand-btn mc-cap-toggle"
          aria-expanded={expanded}
          aria-controls={id}
          data-testid="capped-body-toggle"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}
