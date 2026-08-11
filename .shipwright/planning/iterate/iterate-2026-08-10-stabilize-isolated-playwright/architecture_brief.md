# Architecture brief

Keep mutable E2E isolation at the launcher boundary: a disposable home and
dedicated local Hono/Vite ports are created once per suite. Do not modify
application runtime code or rely on each fixture remembering to self-lock.
