# Architecture Brief: mobile-triage-form-layout

## The problem
On phone-width viewports, the shared task-creation dialog's Launch button is
pushed off-screen, the Triage detail dialog's action buttons overflow past
the dialog edge, Triage cards need excessive scrolling, and the filter bar
cannot be collapsed to save space.

## What would newly, permanently exist
Nothing. This changes machinery that already exists: Tailwind layout classes
on existing dialog/list components, plus one `useState` + the existing
`useIsPhoneViewport()` hook for a collapse toggle.
