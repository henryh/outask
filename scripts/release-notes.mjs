import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fail } from '../app/src/errors.mjs';
import { targets } from './release-config.mjs';

const headings = ['Downloads', 'Current version', "What's new", 'Install', 'Run', 'Documentation'];
const downloadLabels = { 'linux-x64': 'Linux x64', 'macos-arm64': 'macOS Apple silicon', 'windows-x64': 'Windows x64' };

function section(notes, heading, next) {
  const marker = `## ${heading}\n`;
  const start = notes.indexOf(marker) + marker.length;
  const end = next ? notes.indexOf(`## ${next}\n`, start) : notes.length;
  return notes.slice(start, end).trim();
}

function requireDownloadLinks(notes, releaseVersion, repo, selected) {
  const downloads = section(notes, 'Downloads', 'Current version');
  for (const [url] of downloads.matchAll(/https:\/\/[^\s)]+\/OutaskAI-[^\s/)]+\.tar\.gz\b/g)) {
    if (!targets.some((target) => url.endsWith(`-${target}.tar.gz`))) {
      fail('INVALID_INPUT', 'release notes Downloads must not include unsupported archive targets');
    }
  }
  for (const target of selected) {
    const link = `- [${downloadLabels[target]}](https://github.com/${repo}/releases/download/v${releaseVersion}/OutaskAI-${releaseVersion}-${target}.tar.gz)`;
    if (!downloads.includes(link)) fail('INVALID_INPUT', `release notes Downloads must include ${link}`);
  }
}

export function releaseNotes(releaseVersion, packageVersion, repo, selected, value = process.env.RELEASE_NOTES_FILE) {
  value = value?.trim();
  if (!value) fail('INVALID_INPUT', 'RELEASE_NOTES_FILE is required and must name the exact approved release description');
  const path = resolve(value);
  let notes;
  try { notes = readFileSync(path, 'utf8'); }
  catch (error) { fail('READ_ERROR', `${path}: cannot read approved release notes (${error.code})`); }
  if (!notes.endsWith('\n')) fail('INVALID_INPUT', 'release notes must end with a newline');
  if (!notes.startsWith('## Downloads\n')) {
    fail('INVALID_INPUT', 'release notes must start with ## Downloads and must not repeat the GitHub Release title');
  }
  let previous = 0;
  for (const heading of headings) {
    const marker = `## ${heading}\n`;
    const position = notes.indexOf(marker);
    if (position < previous || position === -1 || notes.indexOf(marker, position + marker.length) !== -1) {
      fail('INVALID_INPUT', `release notes must contain one ${marker.trim()} section in the required order`);
    }
    previous = position + marker.length;
  }
  if (releaseVersion !== packageVersion && notes.includes(packageVersion)) {
    fail('INVALID_INPUT', `release notes must use compact zero-patch identifier ${releaseVersion}, not ${packageVersion}`);
  }
  requireDownloadLinks(notes, releaseVersion, repo, selected);
  if (!section(notes, 'Current version', "What's new")) fail('INVALID_INPUT', 'Current version must contain a concise release overview');
  if (!section(notes, "What's new", 'Install')) fail('INVALID_INPUT', "What's new must contain user-visible release changes");
  const install = section(notes, 'Install', 'Run');
  if (!/Node\.js 22\.23\.3 or later/.test(install) || !/\bextract\b/i.test(install) || !/open (?:that|the) directory/i.test(install)) {
    fail('INVALID_INPUT', 'Install must state the Node.js prerequisite, extracting the archive, and opening that directory');
  }
  const installCommands = [...install.matchAll(/```[^\n]*\n([\s\S]*?)```/g)]
    .flatMap((match) => match[1].trim().split('\n'))
    .map((line) => line.trim().replace(/\s+# PowerShell$|\s+& rem cmd\.exe$/g, ''));
  const expected = selected.includes('windows-x64') ? ['./install.sh', './install.cmd', 'install.cmd'] : ['./install.sh'];
  if (JSON.stringify(installCommands) !== JSON.stringify(expected)) {
    fail('INVALID_INPUT', 'Install must show ./install.sh for Linux/macOS and ./install.cmd (PowerShell), install.cmd (cmd.exe) for Windows');
  }
  if (selected.includes('windows-x64') && (!/PowerShell/.test(install) || !/cmd\.exe/.test(install))) {
    fail('INVALID_INPUT', 'Install must distinguish PowerShell and cmd.exe');
  }
  if (/\btar\s+-|\bcd\s+|<platform>/i.test(install)) {
    fail('INVALID_INPUT', 'Install must not include archive extraction, directory-change or platform-placeholder commands');
  }
  const runSection = section(notes, 'Run', 'Documentation');
  if (!/From a project directory/.test(runSection)
    || !/tasks create\b/.test(runSection) || !/tasks list\b/.test(runSection)) {
    fail('INVALID_INPUT', 'Run must demonstrate general create and list use from a project directory');
  }
  const documentation = section(notes, 'Documentation');
  for (const label of ['Basic use', 'Full operator reference', 'MCP setup']) {
    if (!documentation.includes(`[${label}](`)) fail('INVALID_INPUT', `Documentation must link ${label}`);
  }
  return { notes };
}
