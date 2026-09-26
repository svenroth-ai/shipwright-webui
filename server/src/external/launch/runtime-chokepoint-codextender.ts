/*
 * external/launch/runtime-chokepoint-codextender.ts — the launch
 * chokepoint's Codextender-mode branch (Codextender integration Part
 * B.3/B.6), split out of runtime-chokepoint.ts (2026-09-26, bloat
 * anti-ratchet — mirrors the `fork.ts` split out of `lifecycle.ts` for the
 * same "Codextender integration file-size cleanup" reason). A Codextender
 * task drives ordinary `claude` underneath (via a local LiteLLM proxy), not
 * the `codex` CLI, so it needs its own availability probe (the proxy's
 * `/v1/models`, not `codex --version`) and reuses the already-built
 * plain-Claude `commands` the chokepoint received, rather than
 * `buildCodexCommands`.
 */

import {
  buildCodextenderCommands,
  CodextenderCwdMismatchError,
} from "../../core/launcher-codextender.js";
import type { CopyCommandForms } from "../../core/launcher.js";
import type { ExternalTask } from "../../core/sdk-sessions-store.js";
import type { ParsedLaunchBody } from "./parse-body.js";
import {
  codextenderAuthTokenMissingError,
  codextenderCwdMismatchError,
  codextenderProxyUnreachableError,
} from "./runtime-chokepoint-errors.js";
import type { RuntimeChokepointBlocked, RuntimeChokepointOk } from "./runtime-chokepoint.js";

export async function applyCodextenderChokepoint(args: {
  task: ExternalTask;
  parsed: ParsedLaunchBody;
  commands: CopyCommandForms;
  taskUpdate: Partial<ExternalTask>;
  codextenderPort: number;
  checkCodextenderProxyAvailable: () => Promise<boolean>;
  getCodextenderAuthToken: () => string | undefined;
  /** Test seam — defaults to a real probe of the proxy's `/v1/models` for
   *  the selected alias's `max_input_tokens` (operator finding,
   *  2026-09-26: Claude Code assumes a 200K context window for any model id
   *  it doesn't recognize and over-compacts against that wrong ceiling).
   *  `model` is the same value passed to `buildCodextenderCommands`. */
  getCodextenderMaxContextTokens: (model: string | undefined) => Promise<number | undefined>;
}): Promise<RuntimeChokepointOk | RuntimeChokepointBlocked> {
  const {
    task,
    parsed,
    commands,
    taskUpdate,
    codextenderPort,
    checkCodextenderProxyAvailable,
    getCodextenderAuthToken,
    getCodextenderMaxContextTokens,
  } = args;

  if (!(await checkCodextenderProxyAvailable())) {
    return { error: codextenderProxyUnreachableError(codextenderPort), status: 400 };
  }
  const codextenderAuthToken = getCodextenderAuthToken();
  if (!codextenderAuthToken) {
    return { error: codextenderAuthTokenMissingError(), status: 400 };
  }
  const maxContextTokens = await getCodextenderMaxContextTokens(parsed.codexImplementationModel);
  let codextenderCommands: CopyCommandForms;
  try {
    codextenderCommands = buildCodextenderCommands({
      cwd: task.cwd,
      baseUrl: `http://127.0.0.1:${codextenderPort}`,
      model: parsed.codexImplementationModel,
      authToken: codextenderAuthToken,
      claudeCommands: commands,
      maxContextTokens,
    });
  } catch (err) {
    if (!(err instanceof CodextenderCwdMismatchError)) throw err;
    return { error: codextenderCwdMismatchError(), status: 500 };
  }
  return {
    commands: codextenderCommands,
    taskUpdate: {
      ...taskUpdate,
      state: "awaiting_external_start",
      launchedAt: new Date().toISOString(),
      codexIntegrationMode: "codextender",
    },
  };
}
