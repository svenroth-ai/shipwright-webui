import { describe, it, expect, vi } from 'vitest';
import { resolveViteHost } from './resolveViteHost';

const fakeTailscaleExec = (ip = '100.64.0.1') => vi.fn(() => `${ip}\n`);

describe('resolveViteHost', () => {
  it('returns undefined when VITE_HOST is not set (loopback-only default)', () => {
    expect(resolveViteHost({})).toBeUndefined();
  });

  it('returns undefined when VITE_HOST is empty string', () => {
    expect(resolveViteHost({ VITE_HOST: '' })).toBeUndefined();
  });

  it('binds to all interfaces and allows any host when VITE_HOST=true', () => {
    expect(resolveViteHost({ VITE_HOST: 'true' })).toEqual({
      host: true,
      allowedHosts: true,
    });
  });

  it('treats VITE_HOST=1 as truthy alias for true', () => {
    expect(resolveViteHost({ VITE_HOST: '1' })).toEqual({
      host: true,
      allowedHosts: true,
    });
  });

  it('binds to a specific hostname and allows any host when VITE_HOST=<hostname>', () => {
    expect(
      resolveViteHost({ VITE_HOST: 'pc-dinovo-002.tail4353f0.ts.net' }),
    ).toEqual({
      host: 'pc-dinovo-002.tail4353f0.ts.net',
      allowedHosts: true,
    });
  });

  it('binds to a specific IP when VITE_HOST=<ip>', () => {
    expect(resolveViteHost({ VITE_HOST: '100.64.0.1' })).toEqual({
      host: '100.64.0.1',
      allowedHosts: true,
    });
  });

  it('trims surrounding whitespace from VITE_HOST', () => {
    expect(resolveViteHost({ VITE_HOST: '  true  ' })).toEqual({
      host: true,
      allowedHosts: true,
    });
  });

  // === Network profile fallback (ADR-08X) ===

  it('whitespace-only VITE_HOST falls through to profile', () => {
    expect(
      resolveViteHost(
        {
          VITE_HOST: '   ',
          SHIPWRIGHT_NETWORK_PROFILE: 'open',
        },
        fakeTailscaleExec(),
      ),
    ).toEqual({ host: '0.0.0.0', allowedHosts: true });
  });

  it('explicit VITE_HOST overrides profile (backward compat)', () => {
    expect(
      resolveViteHost(
        {
          VITE_HOST: 'true',
          SHIPWRIGHT_NETWORK_PROFILE: 'tailscale',
        },
        fakeTailscaleExec(),
      ),
    ).toEqual({ host: true, allowedHosts: true });
  });

  it('profile=local → undefined (preserve Vite default loopback)', () => {
    // OpenAI review #7: don't change Vite startup behavior for local
    // profile; Vite's own default IS 127.0.0.1, so undefined keeps
    // existing URL printing / detection logic untouched.
    expect(
      resolveViteHost(
        { SHIPWRIGHT_NETWORK_PROFILE: 'local' },
        fakeTailscaleExec(),
      ),
    ).toBeUndefined();
  });

  it('profile=tailscale → host=<ip>, allowedHosts=[<ip>] (narrow, NOT true)', () => {
    // External review (Gemini #3 + OpenAI #2 HIGH): for tailscale
    // profile, allowedHosts must be a narrow allowlist, not `true`.
    expect(
      resolveViteHost(
        { SHIPWRIGHT_NETWORK_PROFILE: 'tailscale' },
        fakeTailscaleExec('100.105.29.88'),
      ),
    ).toEqual({
      host: '100.105.29.88',
      allowedHosts: ['100.105.29.88'],
    });
  });

  it('profile=open → host=0.0.0.0, allowedHosts=true', () => {
    expect(
      resolveViteHost(
        { SHIPWRIGHT_NETWORK_PROFILE: 'open' },
        fakeTailscaleExec(),
      ),
    ).toEqual({ host: '0.0.0.0', allowedHosts: true });
  });

  it('invalid profile → throws', () => {
    expect(() =>
      resolveViteHost(
        { SHIPWRIGHT_NETWORK_PROFILE: 'everywhere' },
        fakeTailscaleExec(),
      ),
    ).toThrow();
  });
});
