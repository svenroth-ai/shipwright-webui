import { describe, it, expect } from 'vitest';
import { resolveViteHost } from './resolveViteHost';

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
      resolveViteHost({ VITE_HOST: 'webui-host.tailnet.ts.net' }),
    ).toEqual({
      host: 'webui-host.tailnet.ts.net',
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
});
