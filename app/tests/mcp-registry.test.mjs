import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { checkDescriptor, verifyRegistryEntry } from '../../scripts/mcp-registry.mjs';

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const descriptor = JSON.parse(readFileSync(new URL('../mcp/server.json', import.meta.url), 'utf8'));
const official = 'io.modelcontextprotocol.registry/official';

test('the tracked MCP Registry descriptor matches the npm manifest', () => {
  checkDescriptor(manifest, descriptor);
});

test('descriptor checks reject a different server or npm package', () => {
  assert.throws(() => checkDescriptor({ ...manifest, mcpName: 'io.github.example/other' }, descriptor), /mcpName/);
  const wrongPackage = { ...descriptor.packages[0], identifier: 'other-package' };
  assert.throws(() => checkDescriptor(manifest, { ...descriptor, packages: [wrongPackage] }), /npm manifest package/);
});

test('both descriptor versions must match the exact npm version', () => {
  assert.throws(() => checkDescriptor(manifest, { ...descriptor, version: 'latest' }), /exact npm manifest version/);
  const wrongVersion = { ...descriptor.packages[0], version: 'latest' };
  assert.throws(() => checkDescriptor(manifest, { ...descriptor, packages: [wrongVersion] }), /exact npm manifest version/);
});

test('descriptor checks reject a package that launches the CLI instead of MCP', () => {
  const wrongLauncher = { ...descriptor.packages[0], packageArguments: [] };
  assert.throws(() => checkDescriptor(manifest, { ...descriptor, packages: [wrongLauncher] }), /positional mcp argument/);
});

test('read-back checks the exact active entry and rejects mismatched published data', async (t) => {
  const response = { server: descriptor, _meta: { [official]: { status: 'active' } } };
  const fetch = t.mock.method(globalThis, 'fetch', async () => Response.json(response));
  assert.equal(await verifyRegistryEntry(descriptor), true);
  assert.equal(fetch.mock.calls[0].arguments[0], `https://registry.modelcontextprotocol.io/v0.1/servers/${encodeURIComponent(descriptor.name)}/versions/${encodeURIComponent(descriptor.version)}`);

  response.server = { ...descriptor, packages: [] };
  await assert.rejects(verifyRegistryEntry(descriptor, { allowMissing: true }), /must be active and match/);
  response.server = descriptor;
  response._meta[official].status = 'deprecated';
  await assert.rejects(verifyRegistryEntry(descriptor), /must be active and match/);
});

test('only a prepublication lookup can accept a missing exact entry', async (t) => {
  let status = 404;
  t.mock.method(globalThis, 'fetch', async () => new Response(null, { status }));
  assert.equal(await verifyRegistryEntry(descriptor, { allowMissing: true }), false);
  await assert.rejects(verifyRegistryEntry(descriptor), /HTTP 404/);
  status = 503;
  await assert.rejects(verifyRegistryEntry(descriptor, { allowMissing: true }), /HTTP 503/);
});
