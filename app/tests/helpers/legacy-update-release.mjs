// Compatibility fixture: exact updater from published v1.4 (60ef40f).
import { createHash } from 'node:crypto';
import { createWriteStream, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { spawnSync } from 'node:child_process';

const repository = 'henryh/outask';
export const latestReleaseUrl = `https://api.github.com/repos/${repository}/releases/latest`;

export function updateTarget(platform = process.platform, arch = process.arch) {
  const target = `${platform === 'darwin' ? 'macos' : platform === 'win32' ? 'windows' : platform}-${arch}`;
  if (!['linux-x64', 'macos-arm64', 'windows-x64'].includes(target)) throw new Error(`Unsupported platform ${target}; use a supported native host`);
  return target;
}

export function latestAsset(release, target) {
  if (release.draft !== false || release.prerelease !== false || !/^v\d+\.\d+(?:\.\d+)?$/.test(release.tag_name)) {
    throw new Error('GitHub Latest did not return a stable published release');
  }
  const version = release.tag_name.slice(1);
  const name = `OutaskAI-${version}-${target}.tar.gz`;
  const url = `https://github.com/${repository}/releases/download/${release.tag_name}/${name}`;
  const asset = release.assets?.find((item) => item.name === name && item.state === 'uploaded');
  if (!asset || asset.browser_download_url !== url) throw new Error(`Latest release has no supported archive ${name}`);
  return { ...asset, version };
}

function run(args) {
  const result = spawnSync(args[0], args.slice(1), { encoding: 'utf8', timeout: 120000, maxBuffer: 8 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error((result.stderr || result.stdout || `${args[0]} exited ${result.status}`).trim());
  return result.stdout;
}

export async function updateRelease({ destination, bin, releases, fetchRelease = fetch, target = updateTarget(), log = console.log }) {
  let work;
  let stage = 'resolve latest release';
  try {
    const request = async (url) => {
      const response = await fetchRelease(url, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'OutaskAI-installer' }, signal: AbortSignal.timeout(120000) });
      if (!response.ok) throw new Error(`HTTP ${response.status} from ${url}`);
      return response;
    };
    const asset = latestAsset(await (await request(latestReleaseUrl)).json(), target);
    const installed = JSON.parse(readFileSync(join(destination, 'release.json'), 'utf8'));
    if (installed.version === asset.version && installed.target === target) {
      log(`Outask AI v${asset.version} is already current.`);
      return;
    }
    work = mkdtempSync(join(tmpdir(), 'outask-update-'));
    const archive = join(work, asset.name);
    stage = `download ${asset.name}`;
    const response = await request(asset.browser_download_url);
    await pipeline(Readable.fromWeb(response.body), createWriteStream(archive));
    const bytes = readFileSync(archive);
    if (bytes.length !== asset.size) throw new Error('Archive size differs from GitHub; retry the download');
    if (asset.digest?.startsWith('sha256:') && `sha256:${createHash('sha256').update(bytes).digest('hex')}` !== asset.digest) {
      throw new Error('Archive SHA256 differs from GitHub; retry the download');
    }
    stage = 'extract latest archive';
    const names = run(['tar', '-tzf', archive]).trim().split(/\r?\n/);
    if (names.some((name) => !/^OutaskAI(?:\/|$)/.test(name) || name.includes('\\') || name.split('/').includes('..'))) {
      throw new Error('Archive contains paths outside OutaskAI');
    }
    run(['tar', '-xzf', archive, '-C', work]);
    const source = join(work, 'OutaskAI');
    const metadata = JSON.parse(readFileSync(join(source, 'release.json'), 'utf8'));
    if (metadata.version !== asset.version || metadata.target !== target) throw new Error('Archive metadata differs from GitHub Latest');
    stage = 'install latest release';
    // The installer stages and verifies its payload before replacing the working copy.
    const output = run([process.execPath, join(source, 'app/scripts/install-release.mjs'), 'install', '--bin-dir', bin, '--release-root', releases]);
    log(output.trim());
    log(`Updated to Outask AI v${asset.version}.`);
  } catch (error) {
    throw new Error(`UPDATE_FAILED: could not ${stage}: ${error.message}. Check network access, tar and directory permissions, then retry update.`);
  } finally {
    if (work) rmSync(work, { recursive: true, force: true });
  }
}
