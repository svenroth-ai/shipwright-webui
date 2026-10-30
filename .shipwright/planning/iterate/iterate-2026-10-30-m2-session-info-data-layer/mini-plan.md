# Mini-plan: M2 read-only session-info data layer

## Acceptance criteria
- AC1 GET /api/external/tasks/:id/session-info returns {status:"ok",info} | {status:"missing"} | 404 unknown task; never writes (transcript bytes unchanged).
- AC2 context.tokens = input+cache_read+cache_creation of newest non-synthetic assistant message; model from same; no percentage / window size fields.
- AC3 Compaction: context.tokens/model/at ALWAYS stay those of the newest non-synthetic assistant usage (spec). A compact_boundary after it sets context.compactedSince=true and context.tokensAfterCompaction=compactor postTokens (null when absent); a later assistant message clears both. Background launch acks (async_launched) never count as completion; rejected writes (tool_result is_error) are retracted from outputs.
- AC4 outputs = Write/Edit/MultiEdit/NotebookEdit file_path/notebook_path, absolute, normalised against each entry's own cwd (win32 and posix), deduped case-insensitively for drive paths, firstAt/lastAt, newest first, subagent writes included with agentId.
- AC5 remoteControl.active only for a live pid whose ~/.claude/sessions/<pid>.json has this sessionId + bridgeSessionId; JSONL bridge-session only sets onceEnabled.
- AC6 subagents from <session>/subagents/agent-*.jsonl + .meta.json: agentType, description, toolUseId, spawnDepth, parentAgentId (depth 2), prompt from the parent Agent tool_use, answer = last assistant text of the agent file, start/end from first/last timestamp, duration from notification; state finished via task-notification (completed/failed/killed/stopped), no notification + stale mtime => finished-stale, else running. Depth-2 notifications come from the depth-1 agent file.
- AC7 100MB+ files: only the newest window is read positionally in 4MB chunks (48MB session / 12MB per agent), partial first line dropped, UTF-8 safe, scan.truncated reported; torn last line tolerated.
- AC8 Read-only + path safety: only read opens; subagent files must match agent-<alnum>.jsonl and be regular files (symlinks skipped); no cross-package imports.
- AC9 Unit tests with fixture JSONL: plain iterate, campaign with depth-2, compaction, remote control, large-file window, route, memo.
