# Architecture Brief: mission-feed-progress-narration

## The problem

On real, tool-heavy working sessions, Mission Activity Feed cards show at
most one machine-derived sentence each, never more, regardless of how much
Claude actually wrote about a step. Two consequences of that same shape:
(1) a turn where Claude wrote real explanation still loses everything past
its first line, so the operator cannot tell from Mission what actually
happened without opening the Terminal; (2) a turn where Claude wrote no
text at all falls back to a fixed generic sentence — measured on one real
production session, 52% of "implementation" cards.

## What already exists here

- The feed already prefers a turn's own first line of narration text over a
  generic sentence, when Claude wrote one.
- A global Settings page with a server-persisted JSON store
  (`GET`/`PUT /api/settings`), read fresh per request by launch-time code.
- A command-construction layer (`core/launcher.ts` +
  `core/actions-substitute.ts`) that already assembles the Claude CLI
  invocation from flags, plugin directories, and a trailing slash-command
  or prompt argument, per launch path.
- A bounded, sanitized excerpt field already exists on some card kinds
  (populated only from tool/test output today, never from Claude's own
  explanation).

## What would newly, permanently exist

A new bounded field on activity cards carrying a turn's own explanation
beyond its first line, read directly from data already recorded in every
session's JSONL (no toggle, no new setting, works on already-recorded
sessions too). Separately, an opt-in, global boolean setting: when on,
every future launch's Claude CLI invocation carries one additional flag
asking Claude to write an ordinary one-line summary as the first line of
its message. From now on, anyone changing how launches are constructed, or
how the activity feed renders a card, has two more things to keep
consistent: the new field's rendering path, and the appended flag across
every launch branch.

## Options on the table

- **A:** Add both — the new explanation field (reads existing JSONL data,
  no toggle) and the opt-in first-line-summary launch flag.
- **B:** Add only the explanation field; leave the generic-fallback-on-silent-turns
  gap unaddressed.
- **C:** Add only the opt-in launch flag; leave Claude's already-written
  explanations discarded past their first line.
- **D:** Do nothing — leave both gaps as they are today.

## Constraints that are not negotiable

none
