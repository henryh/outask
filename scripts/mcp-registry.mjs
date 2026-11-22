#!/usr/bin/env node
import { appendFileSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { parsePackageVersion } from './release-config.mjs';

const officialMeta = 'io.modelcontextprotocol.registry/official';

function packageLaunch(pkg) {
  return {
    registryType: pkg.registryType,
    registryBaseUrl: pkg.registryBaseUrl,
    identifier: pkg.identifier,
    version: pkg.version,
    runtimeHint: pkg.runtimeHint,
    transport: pkg.transport?.type,
    packageArguments: pkg.packageArguments,
    runtimeArguments: pkg.runtimeArguments ?? [],
    environmentVariables: pkg.environmentVariables ?? [],
  };
}

export function checkDescriptor(manifest, descriptor) {
  const [pkg] = Array.isArray(descriptor.packages) ? descriptor.packages : [];
  if (!manifest.mcpName || descriptor.name !== manifest.mcpName) {
    throw new Error('MCP Registry server name must match the npm manifest mcpName');
  }
  const registry = manifest.publishConfig?.registry?.replace(/\/$/, '');
  if (!manifest.name || !registry || descriptor.packages?.length !== 1 || pkg?.registryType !== 'npm'
    || pkg.identifier !== manifest.name || pkg.registryBaseUrl !== registry) {
    throw new Error('MCP Registry descriptor must reference the npm manifest package and registry');
  }
  parsePackageVersion(manifest.version);
  if (descriptor.version !== manifest.version || pkg.version !== manifest.version) {
    throw new Error('Both MCP Registry descriptor versions must match the exact npm manifest version');
  }
  if (pkg.runtimeHint !== 'npx' || pkg.runtimeArguments?.length || pkg.transport?.type !== 'stdio'
    || !isDeepStrictEqual(pkg.packageArguments, [{ type: 'positional', value: 'mcp' }])) {
    throw new Error('MCP Registry package must launch stdio through npx with the positional mcp argument');
  }
}

export async function verifyRegistryEntry(descriptor, { allowMissing = false } = {}) {
  const name = encodeURIComponent(descriptor.name);
  const version = encodeURIComponent(descriptor.version);
  const query = allowMissing ? '?include_deleted=true' : '';
  const url = `https://registry.modelcontextprotocol.io/v0.1/servers/${name}/versions/${version}${query}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (response.status === 404 && allowMissing) return false;
  if (!response.ok) throw new Error(`MCP Registry lookup for ${descriptor.name}@${descriptor.version} returned HTTP ${response.status}`);

  const { server, _meta } = await response.json();
  if (_meta?.[officialMeta]?.status !== 'active' || server?.name !== descriptor.name || server.version !== descriptor.version
    || !Array.isArray(server.packages) || server.packages.length !== 1 || !server.packages[0]
    || !isDeepStrictEqual(packageLaunch(server.packages[0]), packageLaunch(descriptor.packages[0]))
    || !isDeepStrictEqual(server.remotes ?? [], descriptor.remotes ?? [])) {
    throw new Error(`MCP Registry entry for ${descriptor.name}@${descriptor.version} must be active and match the approved server identity and launch settings`);
  }
  return true;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const mode = process.argv[2];
    if (!['check', 'status', 'verify'].includes(mode) || process.argv.length !== 3) {
      throw new Error('Usage: node scripts/mcp-registry.mjs check|status|verify');
    }
    const manifest = JSON.parse(readFileSync(new URL('../app/package.json', import.meta.url), 'utf8'));
    const descriptor = JSON.parse(readFileSync(new URL('../app/mcp/server.json', import.meta.url), 'utf8'));
    checkDescriptor(manifest, descriptor);
    if (mode === 'check') {
      console.log(`MCP Registry descriptor: PASS (${descriptor.name}@${descriptor.version})`);
    } else {
      const exists = await verifyRegistryEntry(descriptor, { allowMissing: mode === 'status' });
      if (mode === 'status' && process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `exists=${exists}\n`);
      console.log(`MCP Registry entry: ${exists ? 'PASS' : 'ABSENT'} (${descriptor.name}@${descriptor.version})`);
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
