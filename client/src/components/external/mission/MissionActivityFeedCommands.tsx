/**
 * The command-chip row for one `MissionActivityFeedCard.tsx` `FeedCard` —
 * split out to keep that file under the project's 300-line convention.
 *
 * Collapsed by default behind a single summary line ("N commands"): a card
 * with several tool calls used to render every command as its own
 * always-visible box (reported: "Implement mit einem Befehl bringt nichts",
 * iterate-2026-09-16-mission-feed-render-fidelity). Expanding reveals the
 * existing chip row, where each chip with real untruncated content behind
 * it is independently click-to-expand (iterate-2026-09-05-mission-feed-ux-
 * gaps) — unchanged by this split.
 */
import { useState } from "react";
import { FileChipIcon } from "./MissionFeedIcons";

interface Props {
  commands: string[];
  /** The true tool-call count — falls back to `commands.length` only for a
   *  caller that never set it (24th-round external review catch, openai,
   *  medium: `commands.length` alone under-counts once dedup collapses two
   *  distinct calls sharing one label). See `ActivityCard.commandCount`. */
  commandCount?: number;
  commandFullText?: Record<string, string>;
  // Opens the command row pre-expanded — used ONLY when a blocker card
  // already nests this inside its own "Show details" disclosure (6th-round
  // external review catch, both reviewers, medium: without this, opening
  // "Show details" still hid the failing command behind a SECOND, nested
  // "N commands" toggle — exactly the double-click the merge into one
  // disclosure was meant to remove). Re-flagged in the 25th round (openai,
  // medium, declined — re-litigates the settled 6th-round decision above):
  // a blocker's own "Show details" toggle already IS the collapsed-by-
  // default affordance requirement 2 asks for; a second, independent "N
  // commands" toggle underneath it would be the exact double-click both
  // reviewers rejected the first time. A non-blocker card never passes
  // this, so its own top-level toggle keeps the ordinary collapsed-by-default
  // behavior requirement 2 mandates.
  // MOUNT-TIME ONLY (39th-round catch, glm, low): this seeds `useState`, so a
  // later change does NOT re-open or re-collapse an already-mounted list. Safe
  // as used — `FeedCard` mounts this inside the blocker disclosure, which is
  // itself unmounted while collapsed, so every mount is a fresh seed. A future
  // caller that keeps it mounted and toggles this prop needs an effect.
  // 52nd-round catch (glm, low), DECLINED: glm calls the comment guard
  // "already present" and only OPTIONALLY suggests a dev-mode warning for a
  // post-mount prop change. There is no such caller (the one call site
  // unmounts while collapsed), so the warning would be dead code shipped to
  // guard a hypothetical — and a `useEffect` comparing a prop to a ref, just
  // to `console.warn`, is more moving parts than the invariant it watches.
  // Re-raised 74th and 79th (glm, low) reaching the same conclusion each time,
  // "None needed now / only revisit if a second call site appears" - unchanged,
  // and still the single call site.
  defaultExpanded?: boolean;
}

export function FeedCommands({ commands, commandCount, commandFullText, defaultExpanded = false }: Props) {
  const [commandsExpanded, setCommandsExpanded] = useState(defaultExpanded);
  const [expandedChip, setExpandedChip] = useState<string | null>(null);

  if (commands.length === 0) return null;
  const count = commandCount ?? commands.length;

  return (
    // No dedicated `.mc-feed-commands` rule (31st-round external review
    // catch, glm, low, declined) — plain block wrapper, no layout of its own;
    // `.mc-feed-expand-btn`/`.mc-feed-chip-row` already carry their own
    // spacing (`mission-operation.css`), so an empty rule here would add
    // nothing.
    <div className="mc-feed-commands">
      <button
        type="button"
        className="mc-feed-expand-btn"
        aria-expanded={commandsExpanded}
        onClick={() => setCommandsExpanded((v) => !v)}
      >
        {commandsExpanded ? "Hide commands" : `${count} command${count === 1 ? "" : "s"}`}
      </button>
      {commandsExpanded && (
        <div className="mc-feed-chip-row">
          {commands.map((command) => {
            // A chip is clickable only when there is real, longer content
            // behind it — reported: "die Befehle kann ich gar nicht
            // anschauen" (a long Bash command could not be inspected past
            // its truncated preview), iterate-2026-09-05-mission-feed-ux-gaps.
            const full = commandFullText?.[command];
            if (!full) return <span className="mc-feed-chip" key={command}><FileChipIcon />{command}</span>;
            const open = expandedChip === command;
            return (
              <span className="mc-feed-chip-wrap" key={command}>
                <button
                  type="button"
                  className="mc-feed-chip mc-feed-chip-clickable"
                  aria-expanded={open}
                  onClick={() => setExpandedChip(open ? null : command)}
                >
                  <FileChipIcon />{command}
                </button>
                {open && (
                  <div className="mc-feed-chip-detail">
                    <pre>{full}</pre>
                  </div>
                )}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
