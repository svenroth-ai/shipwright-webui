# Mini-Plan: network-profile-flag

- **Run ID:** iterate-2026-05-10-network-profile-flag
- **Spec:** [2026-05-10-network-profile-flag.md](2026-05-10-network-profile-flag.md)

## Approach

Insert a profile resolver layer between env-vars and the existing
`resolveViteHost` / `resolveHonoHost`. **Both halves of the dev stack
bind to the same address per profile, so Vite's `/api` proxy target
follows the Hono bind decision.** The post-external-review revisions
incorporate 6 of 12 review findings (1 HIGH proxy-target gap + 5
medium); see "Review-Findings Disposition" below.

```
1. resolveNetworkProfile(env, exec?) → { profile, host } | undefined
   - reads SHIPWRIGHT_NETWORK_PROFILE (lowercase only — UPPER errors)
   - if 'local' → { profile:'local', host:'127.0.0.1' }
   - if 'tailscale' → { profile:'tailscale', host: resolveTailscaleIp(env, exec) }
   - if 'open' → { profile:'open', host:'0.0.0.0' }
     (NO side-effect — pure function. Warning emitted at startup
     entrypoints; see point 5.)
   - if invalid → throw with valid-values list ('local','tailscale','open')
   - if unset/whitespace → return undefined (let caller fall back)

2. resolveTailscaleIp(env, exec) → string
   - if env.SHIPWRIGHT_TAILSCALE_IP set → trim, validate via
     node:net.isIPv4 (per Gemini #2 — replaces dotted-quad regex), return
   - else exec('tailscale ip -4', { encoding:'utf8', timeout:2000 }) →
     parse stdout, split on /\r?\n/ (Windows CRLF — Gemini #4),
     return first VALID IPv4 line (per OpenAI #11 — robust to noise)
   - if exec throws (CLI not found, daemon down, timeout) OR returns
     no valid IPv4 → throw error of shape:
       "tailscale ip -4 returned no IPv4 (or CLI missing). Set
        SHIPWRIGHT_TAILSCALE_IP=<your-tailscale-ip> in .env.local
        as a fallback."

3. resolveViteHost(env) — modified:
   - if env.VITE_HOST trimmed non-empty → existing path (backward compat,
     normalized — empty/whitespace treated as unset per OpenAI #6)
   - else if SHIPWRIGHT_NETWORK_PROFILE set → call resolveNetworkProfile
     - profile='local' → return undefined (preserve Vite's default
       loopback behavior unchanged — OpenAI #7; AC-1 still met because
       Vite's default IS 127.0.0.1)
     - profile='tailscale' → host=<ip>, allowedHosts=[<ip>] (NOT true —
       per Gemini #3 + OpenAI #2; narrows DNS-rebinding protection)
     - profile='open' → host='0.0.0.0', allowedHosts=true
   - else → return undefined (existing default)

4. resolveHonoHost(env) — modified:
   - if env.HONO_HOST trimmed non-empty → existing path (normalized)
   - else if SHIPWRIGHT_NETWORK_PROFILE set → use resolveNetworkProfile
     - profile='local' → '127.0.0.1'
     - profile='tailscale' → <ip>
     - profile='open' → '0.0.0.0'
   - else → '127.0.0.1' (existing default)

5. Startup warning (centralized — OpenAI #1):
   - server/src/index.ts: after `resolveHonoHost(process.env)`, log
     "[network-profile] WARNING: server bound on 0.0.0.0 — exposed on
     every interface; use only on trusted networks" if resolved host
     is '0.0.0.0' OR '::' OR `true` (covers profile=open AND explicit
     HONO_HOST=0.0.0.0/true — OpenAI #9 extends warning to explicit
     opt-out path).
   - client/vite.config.ts: same wording, logged once at config load.

6. Vite proxy target (NEW — Gemini HIGH finding):
   - client/src/lib/resolveProxyTarget.ts (client-only helper) builds
     `http://<bind-ip>:<PORT>` for the /api proxy. bind-ip uses the
     same precedence as resolveHonoHost (HONO_HOST → profile → default).
   - client/vite.config.ts imports resolveProxyTarget, replaces the
     hardcoded `http://localhost:${PORT}` line.
   - In `tailscale` profile: vite proxies to `http://100.x.x.x:3847` — Hono
     binds there too. Same machine, same Tailscale interface, works.
   - In `local` / unset: target=`http://127.0.0.1:3847` (preserves today).
```

`resolveTailscaleIp` accepts an injected `exec` function so unit
tests can stub the subprocess. Production code passes
`child_process.execSync`. Both server and client mirror the function;
a cross-mirror parity test (`server/src/lib/network-profile-sync.test.ts`,
following the action-schema-sync pattern) asserts both copies produce
identical output for matched-vector inputs (per OpenAI #5).

## Files

| File | Op | LOC delta |
|---|---|---|
| `server/src/lib/resolveNetworkProfile.ts` | New | ~60 |
| `server/src/lib/resolveTailscaleIp.ts` | New | ~60 |
| `server/src/lib/resolveNetworkProfile.test.ts` | New | ~100 |
| `server/src/lib/resolveTailscaleIp.test.ts` | New | ~90 |
| `server/src/lib/network-profile-sync.test.ts` | New (cross-mirror parity) | ~50 |
| `server/src/lib/resolveHonoHost.ts` | Edit | +15 |
| `server/src/lib/resolveHonoHost.test.ts` | Edit (extend) | +50 |
| `server/src/index.ts` | Edit (centralized warn) | +8 |
| `client/src/lib/resolveNetworkProfile.ts` | New (mirror per ADR-080) | ~60 |
| `client/src/lib/resolveTailscaleIp.ts` | New (mirror) | ~60 |
| `client/src/lib/resolveProxyTarget.ts` | New (NEW — closes Vite-proxy gap) | ~30 |
| `client/src/lib/resolveNetworkProfile.test.ts` | New | ~100 |
| `client/src/lib/resolveTailscaleIp.test.ts` | New | ~90 |
| `client/src/lib/resolveProxyTarget.test.ts` | New | ~40 |
| `client/src/lib/resolveViteHost.ts` | Edit | +20 |
| `client/src/lib/resolveViteHost.test.ts` | Edit (extend) | +50 |
| `client/vite.config.ts` | Edit (resolveProxyTarget + centralized warn) | +15 |
| `.env.example` | Edit (3 commented blocks + tailscale-IP override) | +30 |
| `docs/guide.md` | Edit | +20 |

Total: 11 new files (5 server + 6 client), 7 edits, 1 ADR.

## Test Strategy

### RED → GREEN unit tests

**resolveTailscaleIp.test.ts:**
- ✅ env override returns env value (trimmed)
- ✅ env override rejects non-IPv4 strings
- ✅ subprocess success → first IPv4 line
- ✅ subprocess returns empty → throws with actionable message
- ✅ subprocess multi-line → returns first line, env override wins
- ✅ subprocess throws (CLI not found) → throws with actionable message naming env override path
- ✅ subprocess returns IPv6 only → throws (we want IPv4)

**resolveNetworkProfile.test.ts:**
- ✅ unset → undefined
- ✅ `local` → host=127.0.0.1, profile=local
- ✅ `tailscale` → calls resolveTailscaleIp, returns its result + profile=tailscale
- ✅ `open` → host=0.0.0.0, profile=open
- ✅ invalid value → throws with valid-values list
- ✅ whitespace-only / empty → undefined (treated as unset)
- ✅ case insensitive (`LOCAL` accepted) — DECIDE: I'll go with case-sensitive lowercase only, error on caps; matches existing env-var conventions

**resolveHonoHost.test.ts (extend):**
- ✅ existing 8 tests pass unchanged (backward compat)
- ✅ HONO_HOST set + profile=tailscale → HONO_HOST wins
- ✅ HONO_HOST unset + profile=local → 127.0.0.1
- ✅ HONO_HOST unset + profile=tailscale → tailscale IP via mock
- ✅ HONO_HOST unset + profile=open → 0.0.0.0
- ✅ HONO_HOST unset + profile=invalid → throws

**resolveViteHost.test.ts (extend):**
- ✅ existing tests pass unchanged
- ✅ profile=local → host='127.0.0.1' (not undefined! — vite needs explicit bind)
- ✅ profile=tailscale → host=<tailscale ip>, allowedHosts=true
- ✅ profile=open → host='0.0.0.0', allowedHosts=true
- ✅ VITE_HOST + profile both set → VITE_HOST wins

### Boundary probe (per references/boundary-probes.md categories)

env-var input is operator-touched, so all 8 probe categories apply:

1. **Empty/missing** — unset profile returns undefined ✓
2. **Whitespace** — `   ` should equal unset ✓
3. **Case** — must error on `LOCAL` to avoid silent-mismatch ✓
4. **Quotes** — env-vars don't usually carry quotes; if user writes
   `SHIPWRIGHT_NETWORK_PROFILE="local"`, dotenv strips them; document
   in `.env.example` that values are unquoted
5. **Encoding** — IP-string is ASCII; no UTF-8 concerns
6. **Trailing newlines** — trim on read ✓
7. **Comments** — `.env.local` line `SHIPWRIGHT_NETWORK_PROFILE=local # cafe` — dotenv handles
8. **POSIX `export`** — dotenv handles; doesn't affect us

### Integration verification (manual smoke, not CI)

After implementation, manually:
- Start both servers with `SHIPWRIGHT_NETWORK_PROFILE=local`,
  `netstat -ano | findstr :3847` shows `127.0.0.1:3847`, NOT
  `0.0.0.0:3847`.
- Start with `SHIPWRIGHT_NETWORK_PROFILE=tailscale` (Tailscale up),
  netstat shows `100.x.x.x:3847`. Try `http://100.x.x.x:5173` from
  Tailscale-paired phone → loads.
- Start with `SHIPWRIGHT_NETWORK_PROFILE=open`, netstat shows
  `0.0.0.0:3847`, server stdout has the warn-line.
- Start with profile unset, netstat shows `127.0.0.1:3847` (default).

### Risk-flag enforcement

- `touches_io_boundary` (env-vars + subprocess output) → Boundary
  Probe required (covered above + dedicated round-trip test cases)
- `touches_build` (`vite.config.ts` is in the canonical list) →
  Performance Budget normally fires. Skip with justification:
  config-only edit affecting bind address; bundle output unchanged
  (env-driven branching at vite-init, no runtime client code change).

## Review-Findings Disposition

| # | Reviewer | Sev | Finding | Action |
|---|---|---|---|---|
| Vite-proxy | Gemini | HIGH | Hardcoded `localhost:3847` proxy target breaks `tailscale` profile | INCORPORATED — new `resolveProxyTarget.ts` + vite.config edit |
| #2 | OpenAI | HIGH | `allowedHosts: true` too broad for tailscale | INCORPORATED — `tailscale` uses `allowedHosts: [<ip>]`, only `open` uses `true` |
| #1 | OpenAI | MED | Warning emission split between resolver + caller | INCORPORATED — resolveNetworkProfile is pure; warn at startup entrypoints |
| #2 (G) / #3 (O) | both | MED | Regex IP-validation allows out-of-bounds octets | INCORPORATED — uses `node:net.isIPv4` |
| #4 (O) / #4 (G) | both | MED/LOW | execSync needs explicit encoding + CRLF handling + timeout | INCORPORATED — `{ encoding:'utf8', timeout:2000 }`, split `/\r?\n/`, take first VALID IPv4 |
| #5 | OpenAI | MED | Mirror duplication risks drift | INCORPORATED — cross-mirror parity test `network-profile-sync.test.ts` |
| #6 | OpenAI | MED | Whitespace-only VITE_HOST/HONO_HOST behavior | INCORPORATED — both resolvers normalize empty/whitespace as unset |
| #7 | OpenAI | MED | profile=local explicit `127.0.0.1` is behavior-change | INCORPORATED — `local` returns undefined for Vite (default loopback unchanged); Hono returns explicit '127.0.0.1' as today |
| #9 | OpenAI | MED | `open` warning only on profile path | INCORPORATED — warning fires on resolved host = 0.0.0.0/`true`/`::`, regardless of source |
| #8 | OpenAI | LOW | Case-sensitivity decision | INCORPORATED — lowercase-only, error on uppercase. Documented in spec + test |
| #11 | OpenAI | LOW | Tailscale stdout robustness | INCORPORATED — parse first VALID IPv4 (not first line) |
| #12 | OpenAI | LOW | Error verbosity | INCORPORATED — concise error template ; no raw stderr dump |
| #5 (G) | Gemini | LOW | Subprocess timeout | INCORPORATED — 2s timeout |
| #10 | OpenAI | LOW | env propagation to both servers | NOTED — `dotenv` loaded by Vite + by Hono via `lib/env`; both halves read same .env.local. Documented in `.env.example` |

## Risk Notes

- **Subprocess injection.** `resolveTailscaleIp` execs `tailscale ip -4` —
  hardcoded command, no user-input substitution. Safe.
- **IP-validation edge cases.** Will use a permissive IPv4 dotted-quad
  regex `/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/` for env-override
  validation. Matches Tailscale CGNAT ranges (100.x.x.x) and standard
  ranges. Tests cover invalid-format input.
- **Tailscale daemon down at server-start time.** `tailscale ip -4`
  exits non-zero or returns empty. We throw a loud error; user sees
  "Tailscale CLI returned no IPv4 — set SHIPWRIGHT_TAILSCALE_IP or
  start Tailscale". Not a silent fall-through to loopback.
- **Stale Tailscale IP cached at boot.** If user reconnects Tailscale
  mid-day and IP changes, the dev-server keeps the old IP. Acceptable
  — dev-server restart picks up new IP. Documented in `.env.example`.
- **`open` profile in untrusted networks.** Mitigated by the loud
  startup warning. Cannot fully prevent operator footgun; the warning
  is the contract.
