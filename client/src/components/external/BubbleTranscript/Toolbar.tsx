/*
 * BubbleTranscript Toolbar — Campaign-C C3 split (2026-05-26).
 *
 * Top strip with the "Showing X of N events" counter, the system-visibility
 * toggle (with N-count + disabled-empty state per 3.7d-b2 UAT), and the
 * "Load older" pagination control. Extracted bit-perfect from the legacy
 * `BubbleTranscript.tsx`.
 */

export function Toolbar({
  total,
  visible,
  canLoadOlder,
  onLoadOlder,
  showSystem,
  systemCount,
  onToggleSystem,
}: {
  total: number;
  visible: number;
  canLoadOlder: boolean;
  onLoadOlder: () => void;
  showSystem: boolean;
  /** Count of system events available to reveal (may be 0). */
  systemCount: number;
  onToggleSystem: () => void;
}) {
  // 3.7d-b2 — if the stream has zero system events, disable the toggle and
  // show a neutral label so it isn't mistaken for a broken button.
  const hasSystem = systemCount > 0;
  const toggleLabel = !hasSystem
    ? "No system messages"
    : showSystem
    ? `Hide system messages (${systemCount})`
    : `Show system messages (${systemCount})`;
  return (
    <div
      className="flex items-center justify-between gap-2 px-3 py-1.5 text-xs"
      style={{
        borderBottom: "1px solid var(--color-border, #e0dbd4)",
        background: "var(--color-surface, #ffffff)",
        color: "var(--color-muted, #6b7280)",
      }}
    >
      <span data-testid="transcript-event-count">
        Showing {visible} of {total} events
      </span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onToggleSystem}
          aria-pressed={showSystem}
          disabled={!hasSystem}
          className="px-2.5 py-0.5 text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60"
          style={{
            border: "1px solid var(--color-border, #e0dbd4)",
            borderRadius: "12px",
            background: showSystem
              ? "var(--color-primary, #6b5e56)"
              : "var(--color-surface, #ffffff)",
            color: showSystem ? "#fff" : "var(--color-muted, #6b7280)",
          }}
          data-testid="system-toggle"
          data-system-count={systemCount}
          title={!hasSystem ? "This task has no system events" : undefined}
        >
          {toggleLabel}
        </button>
        {canLoadOlder && (
          <button
            type="button"
            onClick={onLoadOlder}
            className="px-2.5 py-0.5 text-[11px] font-medium transition-colors"
            style={{
              border: "1px solid var(--color-border, #e0dbd4)",
              borderRadius: "12px",
              background: "var(--color-surface, #ffffff)",
              color: "var(--color-muted, #6b7280)",
            }}
            data-testid="load-older-btn"
          >
            ↑ Load older
          </button>
        )}
      </div>
    </div>
  );
}
