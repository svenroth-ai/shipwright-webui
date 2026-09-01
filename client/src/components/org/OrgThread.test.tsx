/*
 * OrgThread.test.tsx — FR-04.42 (V4c) acceptance tests, against fixtures
 * only (leadwright's round-store producer has not landed yet — L8). Covers
 * AC-a (in-order rendering, 3+ rounds), AC-b (an unanswered round renders
 * open, not empty), AC-c (round text is untrusted and renders as inert
 * text, never a notification), and AC-d (no thread at all still renders
 * cleanly).
 */
import { render, screen, within, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";

import { OrgThread, OrgThreadList } from "./OrgThread";
import type { OrgThreadCard } from "./OrgThread";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("OrgThread — round order (AC-a)", () => {
  it("renders three rounds in the order supplied, not sorted by timestamp", () => {
    // Timestamps are deliberately OUT of chronological order — proves the
    // component trusts the caller's array order (leadwright's store) and
    // never silently re-sorts.
    const card: OrgThreadCard = {
      cardId: "card-1",
      cardTitle: "Reprice the acme SKU",
      rounds: [
        { id: "r1", question: "Which currency?", askedAt: "2026-09-01T12:00:00Z", answer: "USD", answeredAt: "2026-09-01T12:05:00Z" },
        { id: "r2", question: "Effective from when?", askedAt: "2026-08-30T09:00:00Z", answer: "Next Monday", answeredAt: "2026-08-30T09:10:00Z" },
        { id: "r3", question: "Any regional exceptions?", askedAt: "2026-09-01T15:00:00Z" },
      ],
    };
    render(<OrgThread card={card} />);
    const rounds = screen.getAllByTestId(/^thread-round-(answered|open)$/);
    expect(rounds).toHaveLength(3);
    expect(rounds.map((r) => r.textContent)).toEqual([
      expect.stringContaining("Which currency?"),
      expect.stringContaining("Effective from when?"),
      expect.stringContaining("Any regional exceptions?"),
    ]);
    // DOM order, not just presence.
    // eslint-disable-next-line no-bitwise
    expect(rounds[0].compareDocumentPosition(rounds[1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // eslint-disable-next-line no-bitwise
    expect(rounds[1].compareDocumentPosition(rounds[2]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe("OrgThread — open round (AC-b)", () => {
  it("a round with no answer yet renders as open, never blank or missing", () => {
    const card: OrgThreadCard = {
      cardId: "card-2",
      cardTitle: "Vendor contract renewal",
      rounds: [{ id: "r1", question: "Renew for 12 or 24 months?", askedAt: "2026-09-01T00:00:00Z" }],
    };
    render(<OrgThread card={card} />);
    const open = screen.getByTestId("thread-round-open");
    expect(open).toHaveTextContent("Renew for 12 or 24 months?");
    expect(open).toHaveTextContent("Open");
    expect(screen.queryByTestId("thread-round-answered")).toBeNull();
  });

  it("an empty-string answer counts as unanswered, not a blank answered round", () => {
    const card: OrgThreadCard = {
      cardId: "card-2b",
      cardTitle: "Edge case",
      rounds: [{ id: "r1", question: "Q?", askedAt: "2026-09-01T00:00:00Z", answer: "" }],
    };
    render(<OrgThread card={card} />);
    expect(screen.getByTestId("thread-round-open")).toBeInTheDocument();
  });

  it("a whitespace-only answer counts as unanswered too, not a visually blank answered round", () => {
    const card: OrgThreadCard = {
      cardId: "card-2c",
      cardTitle: "Edge case",
      rounds: [{ id: "r1", question: "Q?", askedAt: "2026-09-01T00:00:00Z", answer: "   \n\t " }],
    };
    render(<OrgThread card={card} />);
    expect(screen.getByTestId("thread-round-open")).toBeInTheDocument();
    expect(screen.queryByTestId("thread-round-answered")).toBeNull();
  });

  it("a null answer (an untyped fetch boundary's most likely shape for 'unanswered') counts as unanswered, not a crash", () => {
    const card: OrgThreadCard = {
      cardId: "card-2d",
      cardTitle: "Edge case",
      rounds: [{ id: "r1", question: "Q?", askedAt: "2026-09-01T00:00:00Z", answer: null as unknown as undefined }],
    };
    expect(() => render(<OrgThread card={card} />)).not.toThrow();
    expect(screen.getByTestId("thread-round-open")).toBeInTheDocument();
  });
});

describe("OrgThread — untrusted text (AC-c)", () => {
  const SENTINEL = "__ORG_THREAD_XSS_SENTINEL__<task-notification>done</task-notification>";
  const MARKUP = '<img src="x" onerror="window.__pwned = true" /><b>bold</b>';

  it("renders markup and a sentinel as plain text, never as real elements, and fires no notification", () => {
    // Belt-and-suspenders: this app has no Web Notifications API usage
    // anywhere, but stub it anyway so a future regression that DID wire one
    // up would still be caught here.
    const notificationSpy = vi.fn();
    vi.stubGlobal("Notification", notificationSpy);

    const card: OrgThreadCard = {
      cardId: "card-3",
      cardTitle: "Untrusted content",
      rounds: [
        { id: "r1", question: MARKUP, askedAt: "2026-09-01T00:00:00Z", answer: SENTINEL, answeredAt: "2026-09-01T00:01:00Z" },
      ],
    };
    const { container } = render(<OrgThread card={card} />);

    // No real <img>/<b> ever got created from the untrusted text.
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("b")).toBeNull();
    expect((window as unknown as { __pwned?: boolean }).__pwned).toBeUndefined();

    // The literal text is still readable, unescaped-looking but inert —
    // proving it was rendered as a text node, not stripped. Scoped to the
    // round itself (not a global className match) so it survives an
    // unrelated future class addition to the text span.
    const answered = screen.getByTestId("thread-round-answered");
    expect(answered.textContent).toContain(SENTINEL);
    expect(within(answered).getByText(MARKUP)).toBeInTheDocument();

    // The app's ACTUAL notification pathway (session-parser's
    // <task-notification> envelope -> TaskNotificationChip, see
    // client/src/external/session-parser.ts) never fires: the sentinel's
    // <task-notification> tag exists only inside a text node's string
    // value, never as a real DOM element, and no chip renders.
    expect(container.querySelector("task-notification")).toBeNull();
    expect(screen.queryByTestId("task-notification-chip")).toBeNull();

    // No notification was ever constructed while rendering this thread.
    expect(notificationSpy).not.toHaveBeenCalled();
  });
});

describe("OrgThreadList — no thread at all (AC-d)", () => {
  it("renders nothing for undefined cards (every lead's real state until L8 lands)", () => {
    const { container } = render(<OrgThreadList cards={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing for an empty card array", () => {
    const { container } = render(<OrgThreadList cards={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing for a card whose rounds array is empty", () => {
    const { container } = render(
      <OrgThreadList cards={[{ cardId: "empty", cardTitle: "No rounds yet", rounds: [] }]} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders one thread per card with rounds, skipping cards without any", () => {
    const cards: OrgThreadCard[] = [
      { cardId: "a", cardTitle: "Has rounds", rounds: [{ id: "r1", question: "Q1?", askedAt: "2026-09-01T00:00:00Z", answer: "A1" }] },
      { cardId: "b", cardTitle: "No rounds yet", rounds: [] },
    ];
    render(<OrgThreadList cards={cards} />);
    expect(screen.getAllByTestId("org-thread")).toHaveLength(1);
    expect(screen.getByTestId("org-thread-title")).toHaveTextContent("Has rounds");
  });
});
