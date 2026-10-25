# Architecture Brief: custom-profiles-preview-and-adopt-wiring

## The problem
A project that uses the user's own stack profile never gets a Preview button, because the Preview gate and spawn only know the profiles bundled with the Command Center. Separately, the Adopt screen shows invented sample findings, so the user never sees which stack profile Shipwright actually detected in their repo or why a custom one was skipped.

## Options
1. Resolve the profile through the Shipwright resolver CLI (it reports the file path and validity), read that file, cache the result; add a read-only scan endpoint that runs the adopt analyzer outside the repo and shows its profile block on the Adopt screen.
2. Read the project/user profile directories directly from Node with the same lookup order, and read an already-existing adopt snapshot file only if the repo happens to contain one.
3. Do not support Preview for custom profiles; keep the Adopt screen as sample data and only document the gap.

## What would newly, permanently exist
- A server module that turns a profile name into a runnable Preview profile for custom sources (resolver call + file read + cache).
- A server endpoint that runs a Python analyzer against a user-chosen local folder and returns a small result.
- A client hook and a profile row on the Adopt screen.
- A new place where a command string from a user-writable file can reach the existing dev-server spawner.
