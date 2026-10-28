// Native distribution acceptance substitutes only GitHub's network responses.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const fixture = JSON.parse(readFileSync(process.env.OUTASK_UPDATE_FIXTURE, 'utf8'));
const name = `${fixture.brand || 'Outask'}-${fixture.version}-${fixture.target}.tar.gz`;
const url = `https://github.com/henryh/outask/releases/download/v${fixture.version}/${name}`;
globalThis.fetch = async (requested) => {
  if (fixture.failure === true || (fixture.failure === 'download' && requested === url)) return new Response('unavailable', { status: 503 });
  const bytes = readFileSync(fixture.archive);
  if (requested === 'https://api.github.com/repos/henryh/outask/releases/latest') {
    return Response.json({ tag_name: `v${fixture.version}`, draft: false, prerelease: false,
      assets: [{ name, state: 'uploaded', browser_download_url: url, size: bytes.length,
        digest: `sha256:${createHash('sha256').update(bytes).digest('hex')}` }] });
  }
  if (requested === url) return new Response(bytes);
  throw new Error(`Unexpected URL ${requested}`);
};
