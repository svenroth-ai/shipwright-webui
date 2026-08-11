import { test, expect } from '@playwright/test';
import { API_BASE } from '../helpers/env';

/**
 * Diagnostics — the REAL boot-time Claude CLI probe, end to end.
 *
 * Run-ID: iterate-2026-08-01-win32-spawn-followups (AC-10, F0.5 surface=web).
 *
 * WHY THIS SPEC EXISTS. That iterate re-pointed `server/src/core/cli-compat.ts`
 * at the extracted `core/win32-spawn.ts` and deleted its dead async twin. The
 * probe runs ONCE at server boot, and its result reaches the UI through
 * `GET /api/diagnostics` — so the whole chain (boot -> resolveSpawn ->
 * CreateProcess -> parse -> route -> React) is only falsifiable by booting a
 * real server and looking at a real browser.
 *
 * The neighbouring `diagnostics-launchers-removed.spec.ts` deliberately
 * ROUTE-MOCKS `/api/diagnostics`, which is right for what it asserts (page
 * chrome) and useless for what this asserts (that the probe still works). This
 * one mocks nothing.
 *
 * NOT tagged @smoke on purpose: the @smoke subset is a CI gate, CI runners are
 * ubuntu-latest with no Claude CLI installed, and this spec is about a Windows
 * `.cmd`/`.exe` resolution path. It runs locally against the real stack, where
 * it means something.
 */

const API = API_BASE;

interface CliSnapshot {
  raw: string;
  parsed: { major: number; minor: number; patch: number } | null;
  supported: boolean;
  minSupported: string;
}

test.describe('Diagnostics — real Claude CLI probe through the extracted resolver', () => {
  test('the live API reports a parsed, supported CLI and the page renders it', async ({
    page,
    request,
  }, testInfo) => {
    // --- 1. The API leg: no mock, this is the actual boot-probe result. ------
    const res = await request.get(`${API}/api/diagnostics`);
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { claudeCli: CliSnapshot };
    const cli = body.claudeCli;

    // Runtime conditional skip (first arg not a string => exempt from the
    // quarantine-annotation rule): on a host with no Claude CLI the boot probe
    // has nothing to resolve, and asserting a version would be asserting the
    // host, not the code.
    test.skip(
      !cli.raw,
      'no Claude CLI on this host — the boot probe has nothing to resolve',
    );

    // The probe reached a real binary through resolveSpawn and parsed it.
    expect(cli.parsed).not.toBeNull();
    expect(cli.raw).toMatch(/\d+\.\d+\.\d+/);
    expect(cli.supported).toBe(true);

    // --- 2. The UI leg: the same value, rendered, in a real browser. --------
    /*
     * Two SEPARATE signals, deliberately not collapsed into "no console
     * errors". A bare console-error assertion is both too weak (it cannot say
     * WHICH resource) and too brittle: Vite serves `node_modules` assets
     * through its `/@fs/` escape hatch, and in a worktree whose
     * `client/node_modules` is a junction into the main tree those land outside
     * `server.fs.allow` and 403. That is a property of the dev-server sandbox,
     * never of the app, and it cannot happen in a production build.
     *
     * So: uncaught exceptions must be EMPTY (the real signal), and no failed
     * request may be an `/api/` call or a non-`@fs` asset.
     */
    const pageErrors: string[] = [];
    const failedRequests: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(String(e)));
    page.on('response', (r) => {
      if (r.status() >= 400) failedRequests.push(`${r.status()} ${r.url()}`);
    });

    await page.goto('/diagnostics');
    await expect(page.getByTestId('diagnostics-page')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Claude CLI' })).toBeVisible();

    // The badge is computed from the same snapshot the API returned.
    await expect(page.getByTestId('cli-supported-badge')).toHaveText('yes');

    // And the detected version string itself is on the page.
    const parsedTriple = `${cli.parsed!.major}.${cli.parsed!.minor}.${cli.parsed!.patch}`;
    await expect(page.getByText(cli.raw, { exact: false }).first()).toBeVisible();
    await expect(page.getByText(parsedTriple, { exact: false }).first()).toBeVisible();

    await page.screenshot({
      path: testInfo.outputPath('diagnostics-real-cli-probe.png'),
      fullPage: true,
    });

    expect(pageErrors).toEqual([]);
    expect(failedRequests.filter((u) => !u.includes('/@fs/'))).toEqual([]);
  });
});
