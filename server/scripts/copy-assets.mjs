// Copy runtime non-TS assets into dist/ after `tsc`.
// tsc emits only .js — it does NOT copy JSON/config the server reads
// at runtime. Without this, `node dist/index.js` ENOENTs on
// dist/config/default-actions.json (project-actions-loader).
// src/test/fixtures + src/terminal/fixtures are test-only — NOT copied.
import { cpSync } from "node:fs";
cpSync("src/config", "dist/config", { recursive: true });
console.log("[build] copied src/config -> dist/config");
// src/vendor/leadwright/claim-record-lock-contract.json — read at runtime
// via fs.readFileSync (core/claim-record-lock.ts), not a TS import, so tsc
// never sees it as an input either.
cpSync("src/vendor", "dist/vendor", { recursive: true });
console.log("[build] copied src/vendor -> dist/vendor");
