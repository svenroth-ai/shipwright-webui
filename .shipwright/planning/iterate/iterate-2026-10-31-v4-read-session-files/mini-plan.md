# Mini-plan: V4 session-file route (read files outside the project when the session evidences them)

## Approach
New route `GET /api/external/tasks/:id/session-file?path=` (external/session-file/routes.ts), decision core in core/session-file/.

- access.ts: roots = project path + task cwd. Absolute-or-relative input. Reject NUL, >4096 chars, UNC/device (win32), foreign drive-letter paths (posix). Inside a root: pathGuard + realpath + realPathGuard (symlink escape => 400, never falls through to evidence). Outside: sensitive denylist, then session evidence for the lexical path, plus the realpath if it differs (symlink hop). Unevidenced answers 403 whether or not the file exists.
- evidence.ts: structured outputs from readSessionInfo (Write/Edit/NotebookEdit/MultiEdit incl. subagents) plus a bounded positional scanLines pass over the session JSONL looking for a WHOLE-path mention inside user/assistant text blocks and tool_use input strings. tool_result, attachments, thinking never count. Windows: case- and slash-insensitive. No cache.
- sensitive.ts: .ssh/.gnupg/.aws/.kube/.azure/.docker/.git dirs; .env*, *.env, id_*, .npmrc, .netrc, credentials names.
- safe-read.ts: single open (O_NOFOLLOW|O_NONBLOCK), checks on the handle, lstat dev/ino agreement for win32, size cap before allocation.
- Route: MIME allowlist + 5 MB cap + NUL sniff (415) like the project file route; nosniff + sandbox CSP; ETag; scope header.

## Tests
Route tests with real temp dirs and a synthetic session JSONL: traversal, unevidenced, each evidence source, tool_result not evidence, whole-path boundaries, sensitive names, symlink/junction escape and symlink hop, directory, 404, 413/415, UNC/drive paths, case-insensitive Windows. Unit tests for matcher and denylist.

## Docs
architecture.md Updates line; doc-sync token `session-file`.
