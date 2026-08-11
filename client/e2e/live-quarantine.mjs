/* Explicit live-stack probe entry point; never used by the default suite. */
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";

if (!process.env.BASE_URL) {
  throw new Error("Set BASE_URL to the prepared live stack before running npm run test:e2e:quarantine.");
}

const home = process.env.USERPROFILE || process.env.HOME;
const relativeToTemp = home && path.relative(path.resolve(os.tmpdir()), path.resolve(home));
const temporaryProfile = relativeToTemp === "" || (relativeToTemp && !relativeToTemp.startsWith("..") && !path.isAbsolute(relativeToTemp));
if (process.env.SHIPWRIGHT_E2E_ISOLATED !== "1" || !temporaryProfile) {
  throw new Error(
    "Quarantined transcript seeding requires SHIPWRIGHT_E2E_ISOLATED=1 and a temporary HOME/USERPROFILE. " +
    "Start the prepared live Claude stack with that same temporary profile, then rerun this command.",
  );
}

function run(config, project) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["node_modules/@playwright/test/cli.js", "test", `--config=${config}`, `--project=${project}`, ...process.argv.slice(2)],
      { cwd: process.cwd(), env: process.env, stdio: "inherit" },
    );
    child.once("error", reject);
    child.once("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${project} exited ${code ?? 1}`))));
  });
}

try {
  // The first probe needs a real MagicDNS/Tailscale stack. The second needs a
  // real Claude process, but its server and runner deliberately share this
  // temporary profile so its synthetic JSONL and registry data stay disposable.
  await run("playwright.tailscale-quarantine.config.ts", "tailscale-quarantine");
  await run("playwright.quarantine.config.ts", "quarantine");
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
