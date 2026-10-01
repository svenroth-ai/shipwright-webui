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

test('backend host follows the real bind, not blind loopback', () => {
  const noIp = () => { throw new Error('must not be called'); };
  assert.equal(resolveBackendHost({}, noIp), '127.0.0.1');
  assert.equal(resolveBackendHost({ SHIPWRIGHT_NETWORK_PROFILE: 'local' }, noIp), '127.0.0.1');
  assert.equal(resolveBackendHost({ SHIPWRIGHT_NETWORK_PROFILE: 'open' }, noIp), '127.0.0.1');
  assert.equal(resolveBackendHost({ HONO_HOST: 'true' }, noIp), '127.0.0.1');
  assert.equal(resolveBackendHost({ HONO_HOST: '192.168.1.5' }, noIp), '192.168.1.5');
  assert.equal(resolveBackendHost({ SHIPWRIGHT_NETWORK_PROFILE: 'tailscale', SHIPWRIGHT_TAILSCALE_IP: '100.1.2.3' }, noIp), '100.1.2.3');
  assert.equal(resolveBackendHost({ SHIPWRIGHT_NETWORK_PROFILE: 'tailscale' }, () => '100.9.9.9'), '100.9.9.9');
  assert.throws(() => resolveBackendHost({ SHIPWRIGHT_NETWORK_PROFILE: 'tailscale' }, () => ''), /Tailscale IPv4/);
});

test('serve args are tailnet-only (never funnel) and background-persistent', () => {
  const args = buildServeArgs({ host: '100.9.9.9', port: 3847, httpsPort: 443 });
  assert.deepEqual(args, ['serve', '--bg', '--https=443', 'http://100.9.9.9:3847']);
  assert.ok(!args.includes('funnel'));
});
