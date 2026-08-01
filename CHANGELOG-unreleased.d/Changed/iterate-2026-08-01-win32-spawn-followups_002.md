Windows path parsing in the spawn resolver is pinned to win32 semantics rather than the host's, so the Windows-only code paths are tested as Windows on Linux CI instead of silently under POSIX rules.
