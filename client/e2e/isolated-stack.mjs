/*
 * Default Playwright harness: an ephemeral HOME plus dedicated Hono/Vite ports.
 * Mutable E2E specs must never inherit the operator's registry through BASE_URL.
 */
import { spawn } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const clientDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(clientDir, "..");
const serverDir = path.join(repoRoot, "server");

function under(parent, child) {
  const normal = (value) => process.platform === "win32" ? value.toLowerCase() : value;
  const relative = path.relative(normal(parent), normal(child));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export async function assertIsolatedRegistry(home) {
  const registry = path.join(home, ".shipwright-webui");
  const [resolvedTemp, resolvedRegistry] = await Promise.all([realpath(os.tmpdir()), realpath(registry)]);
  if (!under(resolvedTemp, resolvedRegistry)) {
    throw new Error(`Refusing E2E run: registry is outside OS temp (${resolvedRegistry}).`);
  }
  return resolvedRegistry;
}

export function fixturePath(value, tempRoot = os.tmpdir()) {
  return under(path.resolve(tempRoot), path.resolve(value))
    || under(repoRoot, path.resolve(value))
    || /^[a-z]:[\\/]tmp(?:[\\/]|$)|^\/tmp(?:\/|$)/i.test(value)
    || /[\\/]\.worktrees[\\/]/i.test(value);
}

export function contaminatingUnassignedTasks(store, tempRoot) {
  return Object.values(store.sessions ?? {}).filter(
    (task) => task && task.projectId === "unassigned" && typeof task.cwd === "string" && fixturePath(task.cwd, tempRoot),
  );
}

export function isolatedPlaywrightEnv(commonEnv, baseUrl, serverPort, clientPort) {
  return {
    ...commonEnv,
    BASE_URL: baseUrl,
    API_BASE_URL: baseUrl,
    WEBUI_API_URL: baseUrl,
    PORT: String(serverPort),
    VITE_PORT: String(clientPort),
  };
}

async function freePort() {
  return await new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      probe.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

function run(command, args, options) {
  return spawn(command, args, { stdio: "inherit", ...options });
}

async function waitFor(url, child) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (child && "exitCode" in child && child.exitCode !== null) {
      throw new Error(`Isolated stack exited before readiness (${child.exitCode}).`);
    }
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The listener has not bound yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for isolated stack at ${url}.`);
}

async function exitCode(child) {
  return await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
}

async function stop(child) {
  if (!child) return;
  if (typeof child.close === "function") {
    // A browser may still hold a keep-alive or WebSocket while Playwright is
    // unwinding. This listener belongs solely to the disposable client proxy;
    // drain it before waiting for close so a finished suite cannot hang.
    child.closeAllConnections?.();
    child.closeIdleConnections?.();
    await new Promise((resolve) => child.close(() => resolve()));
    return;
  }
  if (child.exitCode !== null) return;
  child.kill();
  await exitCode(child).catch(() => {});
}

async function startClientProxy(clientPort, serverPort) {
  const ignoreExpectedSocketError = (error) => {
    // The proxy is disposable; this listener prevents normal browser WS
    // teardown from escaping as an unhandled Node error.
    void error;
  };
  const upstreamHeaders = (headers) => ({
    ...headers,
    host: `127.0.0.1:${serverPort}`,
  });
  const client = http.createServer((request, response) => {
    const upstream = http.request({
      host: "127.0.0.1",
      port: serverPort,
      method: request.method,
      path: request.url,
      headers: upstreamHeaders(request.headers),
    }, (upstreamResponse) => {
      response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
      upstreamResponse.pipe(response);
    });
    upstream.on("error", (error) => {
      if (!response.headersSent) response.writeHead(502, { "Content-Type": "text/plain" });
      response.end(`isolated client proxy error: ${error.message}`);
    });
    request.pipe(upstream);
  });
  client.on("upgrade", (request, socket, head) => {
    socket.on("error", ignoreExpectedSocketError);
    const upstream = http.request({
      host: "127.0.0.1",
      port: serverPort,
      method: request.method,
      path: request.url,
      headers: upstreamHeaders(request.headers),
    });
    // A terminal route may deliberately reject an upgrade (for example a
    // missing cwd in the reconnect-outage probe). `upgrade` does not fire for
    // that HTTP response; forwarding it makes the browser close immediately
    // and lets the retry scheduler follow its normal backoff instead of waiting
    // for the connect watchdog.
    upstream.on("response", (upstreamResponse) => {
      const headers = Object.entries(upstreamResponse.headers)
        .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(", ") : value}`)
        .join("\r\n");
      socket.write(`HTTP/1.1 ${upstreamResponse.statusCode ?? 502} ${upstreamResponse.statusMessage ?? "Bad Gateway"}\r\n${headers}\r\n\r\n`);
      upstreamResponse.pipe(socket);
    });
    upstream.on("upgrade", (upstreamResponse, upstreamSocket, upstreamHead) => {
      const headers = Object.entries(upstreamResponse.headers)
        .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(", ") : value}`)
        .join("\r\n");
      socket.write(`HTTP/1.1 ${upstreamResponse.statusCode ?? 101} ${upstreamResponse.statusMessage ?? "Switching Protocols"}\r\n${headers}\r\n\r\n`);
      if (head.length > 0) upstreamSocket.write(head);
      if (upstreamHead.length > 0) socket.write(upstreamHead);
      upstreamSocket.on("error", ignoreExpectedSocketError);
      socket.pipe(upstreamSocket).pipe(socket);
    });
    upstream.on("error", () => socket.destroy());
    upstream.end();
  });
  await new Promise((resolve, reject) => {
    client.once("error", reject);
    client.listen(clientPort, "127.0.0.1", () => resolve());
  });
  return client;
}

async function assertNoContamination(home) {
  const storePath = path.join(home, ".shipwright-webui", "sdk-sessions.json");
  let store;
  try {
    store = JSON.parse(await readFile(storePath, "utf8"));
  } catch (error) {
    if (error && error.code === "ENOENT") return;
    throw error;
  }
  const leaked = contaminatingUnassignedTasks(store, os.tmpdir());
  if (leaked.length > 0) {
    throw new Error(`E2E contamination guard found ${leaked.length} unassigned fixture task(s): ${leaked.map((task) => task.cwd).join(", ")}`);
  }
}

async function removeUnassignedFixtureTasks(baseUrl, home) {
  const response = await fetch(`${baseUrl}/api/external/tasks`);
  if (!response.ok) throw new Error(`Unable to list E2E tasks for cleanup (${response.status}).`);
  const { tasks = [] } = await response.json();
  const owned = tasks.filter(
    (task) => task?.projectId === "unassigned" && typeof task.cwd === "string" && fixturePath(task.cwd),
  );
  if (owned.length === 0) {
    await assertNoContamination(home);
    return;
  }
  // A green suite must prove its OWN fixtures cleaned up. Do not erase that
  // signal first: record the failure, then make a best-effort recovery so a
  // failed local run cannot leave disposable state behind for diagnosis.
  const detail = owned.map((task) => task.cwd).join(", ");
  try {
    for (const task of owned) {
      const deleted = await fetch(`${baseUrl}/api/external/tasks/${encodeURIComponent(task.taskId)}`, {
        method: "DELETE",
      });
      if (!deleted.ok) throw new Error(`Unable to remove E2E fixture task ${task.taskId} (${deleted.status}).`);
    }
    await assertNoContamination(home);
  } finally {
    throw new Error(`E2E contamination guard found ${owned.length} unassigned fixture task(s): ${detail}`);
  }
}

async function prepareReadinessPrerequisites(home) {
  const cacheParent = path.join(home, ".claude", "plugins", "cache");
  const cacheRoot = path.join(cacheParent, "shipwright");
  // Readiness only needs the door names plus its shared-cache canary. Seed
  // those tiny, disposable markers instead of reaching into the operator's
  // plugin cache; this keeps a clean CI profile genuinely self-contained.
  await mkdir(path.join(cacheRoot, "shipwright-adopt"), { recursive: true });
  await mkdir(path.join(cacheRoot, "shipwright-grade"), { recursive: true });
  await mkdir(path.join(cacheRoot, "shared", "scripts", "hooks"), { recursive: true });
  await writeFile(path.join(cacheRoot, "shared", "scripts", "hooks", "capture_session_id.py"), "# e2e readiness canary\n", "utf8");
  // Mutable triage E2Es use the same cache-owned CLI boundary as production.
  // The isolated profile supplies a deliberately small writer that preserves
  // the JSONL event protocol those flows exercise; it never reaches into the
  // operator's plugin cache.
  const triageTools = path.join(cacheRoot, "shared", "scripts", "tools");
  await mkdir(triageTools, { recursive: true });
  await writeFile(path.join(triageTools, "triage_cli.py"), String.raw`import json
import os
import sys
from datetime import datetime, timezone

argv = sys.argv[1:]
root = argv[argv.index("--project-root") + 1]
operation = argv[argv.index("--project-root") + 2]
item_id = argv[argv.index("--project-root") + 3]
options = {}
for arg in argv:
    if arg.startswith("--") and "=" in arg:
        key, value = arg[2:].split("=", 1)
        options[key] = value
triage_path = os.path.join(root, ".shipwright", "triage.jsonl")
with open(triage_path, encoding="utf-8") as source:
    events = [json.loads(line) for line in source if line.strip()]
item = next((dict(event) for event in events if event.get("event") == "append" and event.get("id") == item_id), None)
if item is None:
    sys.exit(4)
item.pop("event", None)
for event in events:
    if event.get("id") != item_id:
        continue
    if event.get("event") == "amend":
        for key in ("title", "detail", "severity", "kind"):
            if key in event:
                item[key] = event[key]
        item["amendedBy"] = event.get("by")
        item["amendedAt"] = event.get("ts")
    elif event.get("event") == "status":
        item["status"] = event.get("newStatus", item.get("status"))
        item["revisitAt"] = event.get("revisitAt") if event.get("newStatus") == "snoozed" else None
ts = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
if operation == "amend":
    event = {"event": "amend", "id": item_id, "ts": ts, "by": "webui"}
    for key in ("title", "detail", "severity"):
        if key in options:
            event[key] = options[key]
            item[key] = options[key]
    item["amendedBy"] = "webui"
    item["amendedAt"] = ts
elif operation in ("snooze", "dismiss"):
    status = "snoozed" if operation == "snooze" else "dismissed"
    event = {"event": "status", "id": item_id, "ts": ts, "newStatus": status, "by": "webui", "reason": options.get("reason"), "promotedTaskId": None}
    if status == "snoozed":
        event["revisitAt"] = options.get("revisit")
        item["revisitAt"] = options.get("revisit")
    item["status"] = status
else:
    sys.exit(3)
with open(triage_path, "a", encoding="utf-8") as output:
    output.write(json.dumps(event, separators=(",", ":")) + "\n")
print(json.dumps({"operation": operation, "item": item}, separators=(",", ":")))
`, "utf8");
  const bin = path.join(home, "e2e-bin");
  await mkdir(bin, { recursive: true });
  // iterate-2026-08-26-grade-uv-run: production now spawns `uv run --project
  // <dir>|--python <spec> [--no-project] <script> [args...]` instead of a
  // bare python (the ModuleNotFoundError bug — see uv-runner.ts). The old
  // fake `uv` only ever had to answer `--version` for the readiness gate; it
  // never had to actually RUN a script, because nothing spawned it to do so.
  // Now the triage-write E2Es do. `uv-shim.mjs` keeps the `--version` reply
  // for readiness and adds a `run` passthrough: strip the leading uv flags
  // (a fixed VALUE_FLAGS set of value-taking ones — `--project <dir>` /
  // `--python <spec>` — each consumes its next argv slot; anything else
  // starting with `--`, e.g. the doubt-review-driven `--no-project`, is a
  // boolean and consumes none), then exec the remaining `<script> [args...]`
  // with `python` — the SAME bare-name resolution (bin dir's
  // `python.cmd`/`python` first, else real PATH) this harness already relied
  // on before uv sat in front of it.
  const shim = path.join(bin, "uv-shim.mjs");
  await writeFile(shim, String.raw`import { spawnSync } from "node:child_process";
const argv = process.argv.slice(2);
if (argv[0] === "--version") {
  process.stdout.write("uv 0.0.0-e2e\n");
  process.exit(0);
}
if (argv[0] === "run") {
  const VALUE_FLAGS = new Set(["--project", "--python"]);
  let i = 1;
  while (i < argv.length && argv[i].startsWith("--")) i += VALUE_FLAGS.has(argv[i]) ? 2 : 1;
  const result = spawnSync("python", argv.slice(i), { stdio: "inherit", shell: false });
  process.exit(result.status ?? 1);
}
process.exit(1);
`, "utf8");
  if (process.platform === "win32") {
    await writeFile(path.join(bin, "uv.cmd"), `@echo off\r\nnode "${shim}" %*\r\n`, "utf8");
    // Codex's bundled Node and Python runtimes are siblings. Do not shadow a
    // developer's working Python with a guessed nonexistent path.
    const bundledPython = path.resolve(path.dirname(process.execPath), "..", "..", "python", "python.exe");
    const python = process.env.SHIPWRIGHT_E2E_PYTHON ?? bundledPython;
    try {
      await access(python);
      await writeFile(path.join(bin, "python.cmd"), `@echo off\r\n"${python}" %*\r\n`, "utf8");
    } catch {
      // Leave the normal PATH untouched; a standard developer Python remains
      // discoverable by the fixture process.
    }
  } else {
    await writeFile(path.join(bin, "uv"), `#!/usr/bin/env sh\nexec node "${shim}" "$@"\n`, { encoding: "utf8", mode: 0o755 });
    // CI's python remains on PATH. An explicit override is honoured without
    // relying on Windows-only .cmd resolution.
    if (process.env.SHIPWRIGHT_E2E_PYTHON) {
      await writeFile(path.join(bin, "python"), `#!/usr/bin/env sh\nexec "${process.env.SHIPWRIGHT_E2E_PYTHON}" "$@"\n`, { encoding: "utf8", mode: 0o755 });
    }
  }
  return bin;
}

export async function main(args = process.argv.slice(2)) {
  if (process.env.BASE_URL) {
    throw new Error("Refusing externally supplied BASE_URL for the mutable E2E suite. Use the quarantine command for real-device tests.");
  }
  const home = await mkdtemp(path.join(os.tmpdir(), "sw-e2e-home-"));
  const [serverPort, clientPort] = await Promise.all([freePort(), freePort()]);
  let server;
  let client;
  try {
    const readinessBin = await prepareReadinessPrerequisites(home);
    const commonEnv = {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      SHIPWRIGHT_E2E_ISOLATED: "1",
      // The stack starts from its own newly-created registry, so this is the
      // deliberate empty-install surface used by the First Contact E2E probe.
      SHIPWRIGHT_E2E_EMPTY_REGISTRY: "1",
      SHIPWRIGHT_E2E_HARNESS: "temporary-home",
      SHIPWRIGHT_NETWORK_PROFILE: "local",
      PATH: `${readinessBin}${path.delimiter}${process.env.PATH ?? ""}`,
    };
    // tsx calls os.userInfo() while bootstrapping on Windows, which cannot run
    // with a synthetic USERPROFILE. Compile under the normal tool environment;
    // only the application process receives the isolated profile.
    const build = run(process.execPath, ["node_modules/typescript/bin/tsc", "-p", "tsconfig.json"], {
      cwd: serverDir,
    });
    if (await exitCode(build) !== 0) throw new Error("Unable to compile the isolated E2E server.");
    const assets = run(process.execPath, ["scripts/copy-assets.mjs"], { cwd: serverDir });
    if (await exitCode(assets) !== 0) throw new Error("Unable to copy isolated E2E server assets.");
    // Production React avoids the development-only StrictMode mount probe
    // taking the terminal's writer lease before the actual test view attaches.
    // The isolated client proxy below preserves a distinct client port and
    // forwards HTTP + WS traffic to the isolated server exactly as Vite did.
    const clientBuild = run(process.execPath, ["node_modules/vite/bin/vite.js", "build"], {
      cwd: clientDir,
    });
    if (await exitCode(clientBuild) !== 0) throw new Error("Unable to build the isolated E2E client.");
    server = run(process.execPath, ["dist/index.js"], {
      cwd: serverDir,
      env: { ...commonEnv, PORT: String(serverPort) },
      stdio: "ignore",
    });
    await waitFor(`http://127.0.0.1:${serverPort}/api/projects`, server);
    client = await startClientProxy(clientPort, serverPort);
    const baseUrl = `http://127.0.0.1:${clientPort}`;
    await waitFor(`${baseUrl}/api/projects`, client);
    await assertIsolatedRegistry(home);

    const playwright = run(process.execPath, ["node_modules/@playwright/test/cli.js", "test", ...args], {
      cwd: clientDir,
      env: isolatedPlaywrightEnv(commonEnv, baseUrl, serverPort, clientPort),
    });
    const code = await exitCode(playwright);
    await removeUnassignedFixtureTasks(baseUrl, home);
    return code;
  } finally {
    await stop(client);
    await stop(server);
    await rm(home, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().then((code) => { process.exitCode = code; }).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
