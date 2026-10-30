# Architecture brief - M1

Problem: the Mission activity feed synthesizes an error/blocker card ("A command failed: ...", plus a reconcile sentence about the run ending before the blocker was resolved) for any failed plain command. The operator wants no error messages in the chat at all; errors are handled in the terminal.

Options:
1. Do nothing (keep error cards).
2. Hide the blocker card only at render time (CSS/filter) while the reducer still builds it.
3. Stop producing the card in the reducer and delete the now-dead blocker machinery (kind, recovery path, reconcile sentence, renderer branch, summarizer).

Constraint: interactive questions/blockers (kind user-input), test-failure cards, failed subrunner cards and the Shipwright delivery/PR cards must keep working.
