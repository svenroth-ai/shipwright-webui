// node --test scripts/tailscale-https.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseEnvFile, isEnabled, resolveHttpsPort, resolveBackendHost, buildServeArgs,
} from './tailscale-https.mjs';

test('parseEnvFile: comments, quotes, CRLF, values containing =', () => {
  const env = parseEnvFile('# c\r\nA=1\r\nB="two"\r\nC=x=y\r\n\r\n=bad\r\n');
  assert.deepEqual(env, { A: '1', B: 'two', C: 'x=y' });
});

test('isEnabled is strictly opt-in', () => {
  assert.equal(isEnabled({}), false);
  assert.equal(isEnabled({ SHIPWRIGHT_TAILSCALE_HTTPS: '0' }), false);
  assert.equal(isEnabled({ SHIPWRIGHT_TAILSCALE_HTTPS: '1' }), true);
  assert.equal(isEnabled({ SHIPWRIGHT_TAILSCALE_HTTPS: ' TRUE ' }), true);
});

test('resolveHttpsPort defaults to 443 and rejects junk', () => {
  assert.equal(resolveHttpsPort({}), 443);
  assert.equal(resolveHttpsPort({ SHIPWRIGHT_TAILSCALE_HTTPS_PORT: '8443' }), 8443);
  for (const bad of ['abc', '0', '70000', '-1']) {
    assert.equal(resolveHttpsPort({ SHIPWRIGHT_TAILSCALE_HTTPS_PORT: bad }), 443);
  }
});

test('backend host is loopback (tailscaled cannot dial its own tailnet IP) unless HONO_HOST names a real address', () => {
  assert.equal(resolveBackendHost({}), '127.0.0.1');
  assert.equal(resolveBackendHost({ SHIPWRIGHT_NETWORK_PROFILE: 'tailscale', SHIPWRIGHT_TAILSCALE_IP: '100.1.2.3' }), '127.0.0.1');
  assert.equal(resolveBackendHost({ SHIPWRIGHT_NETWORK_PROFILE: 'open' }), '127.0.0.1');
  assert.equal(resolveBackendHost({ HONO_HOST: 'true' }), '127.0.0.1');
  assert.equal(resolveBackendHost({ HONO_HOST: '0.0.0.0' }), '127.0.0.1');
  assert.equal(resolveBackendHost({ HONO_HOST: '192.168.1.5' }), '192.168.1.5');
});

test('serve args are tailnet-only (never funnel) and background-persistent', () => {
  const args = buildServeArgs({ host: '100.9.9.9', port: 3847, httpsPort: 443 });
  assert.deepEqual(args, ['serve', '--bg', '--https=443', 'http://100.9.9.9:3847']);
  assert.ok(!args.includes('funnel'));
});
