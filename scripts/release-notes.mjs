import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fail } from '../app/src/errors.mjs';
import { targets } from './release-config.mjs';

const headings = ['Downloads', "What's new", 'Install', 'Run', 'Documentation'];
const downloadLabels = { 'linux-x64': 'Linux x64', 'macos-arm64': 'macOS Apple silicon', 'windows-x64': 'Windows x64' };

function section(notes, heading) {
  const marker = `## ${heading}\n`;
  const start = notes.indexOf(marker) + marker.length;
  const end = notes.indexOf('\n## ', start);
  return notes.slice(start, end === -1 ? notes.length : end).trim();
}

function requireDownloadLinks(notes, releaseVersion, repo, selected, legacy) {
  const downloads = section(notes, 'Downloads');
  const links = selected.map(target => `- [${downloadLabels[target]}](https://github.com/${repo}/releases/download/v${releaseVersion}/Outask-${releaseVersion}-${target}.tar.gz)`);
  if (!legacy && downloads.split('\n').filter(line => line.trim()).join('\n') !== links.join('\n')) {
    fail('INVALID_INPUT', 'release notes Downloads must contain only the three direct platform archive links in Linux/macOS/Windows order');
  }
  for (const link of links) {
    if (!downloads.includes(link)) fail('INVALID_INPUT', `release notes Downloads must include ${link}`);
  }
  for (const [url] of downloads.matchAll(/https:\/\/[^\s)]+\/Outask-[^\s/)]+\.tar\.gz\b/g)) {
    if (!targets.some(target => url.endsWith(`-${target}.tar.gz`))) {
      fail('INVALID_INPUT', 'release notes Downloads must not include unsupported archive targets');
    }
  }
}

export function releaseNotes(releaseVersion, packageVersion, repo, selected, value = process.env.RELEASE_NOTES_FILE, { recovery = false } = {}) {
  value = value?.trim();
  if (!value) fail('INVALID_INPUT', 'RELEASE_NOTES_FILE is required and must name the exact approved release description');
  const path = resolve(value);
  let notes;
  try { notes = readFileSync(path, 'utf8'); }
  catch (error) { fail('READ_ERROR', `${path}: cannot read approved release notes (${error.code})`); }
  if (!notes.endsWith('\n')) fail('INVALID_INPUT', 'release notes must end with a newline');
  const approved = notes;
  notes = notes.replace(/\r\n/g, '\n');
  const legacy = recovery && notes.startsWith('## Downloads\n');
  const requiredHeadings = legacy ? ['Downloads', 'Current version', ...headings.slice(1)] : headings;
  if (!legacy) {
    const readme = readFileSync(resolve('README.md'), 'utf8').replace(/\r\n/g, '\n');
    const paragraph = readme.match(/^# [^\n]+\n+([\s\S]*?)(?:\n\s*\n|$)/)?.[1].replace(/\s+/g, ' ').trim();
    const opening = paragraph?.match(/^.*?[.!?](?=\s|$)/)?.[0];
    if (!opening || !notes.startsWith(`${opening}\n\n## Downloads\n`)) {
      fail('INVALID_INPUT', 'release notes must start with the unheaded README opening sentence followed by ## Downloads');
    }
  }
  if (JSON.stringify([...notes.matchAll(/^## (.+)$/gm)].map(match => match[1])) !== JSON.stringify(requiredHeadings)) {
    fail('INVALID_INPUT', 'release notes must contain only the required sections in order');
  }
  if (releaseVersion !== packageVersion && notes.includes(packageVersion)) {
    fail('INVALID_INPUT', `release notes must use compact zero-patch identifier ${releaseVersion}, not ${packageVersion}`);
  }
  requireDownloadLinks(notes, releaseVersion, repo, selected, legacy);
  if (legacy && !section(notes, 'Current version')) fail('INVALID_INPUT', 'Current version must contain a concise release overview');
  if (!section(notes, "What's new")) fail('INVALID_INPUT', "What's new must contain user-visible release changes");
  const install = section(notes, 'Install');
  if (!/Node\.js 22\.23\.3 or later/.test(install) || !/\bextract\b/i.test(install) || !/open (?:that|the) directory/i.test(install)) {
    fail('INVALID_INPUT', 'Install must state the Node.js prerequisite, extracting the archive, and opening that directory');
  }
  const installCommands = [...install.matchAll(/```[^\n]*\n([\s\S]*?)```/g)]
    .flatMap((match) => match[1].trim().split('\n'))
    .map((line) => line.trim().replace(/\s+# PowerShell$|\s+& rem cmd\.exe$/g, ''));
  // Recovery validates the original approved notes without changing their commands.
  const expected = selected.includes('windows-x64')
    ? [['./install.sh', './Install.command', './Install.cmd', 'Install.cmd'], ['./install.sh', './install.cmd', 'install.cmd']]
    : [['./install.sh', './Install.command'], ['./install.sh']];
  if (!(legacy ? expected : expected.slice(0, 1)).some((commands) => JSON.stringify(installCommands) === JSON.stringify(commands))) {
    fail('INVALID_INPUT', 'Install must show ./install.sh for Linux, ./Install.command for macOS and ./Install.cmd (PowerShell), Install.cmd (cmd.exe) for Windows; recovery may retain the original approved installer commands');
  }
  if (selected.includes('windows-x64') && (!/PowerShell/.test(install) || !/cmd\.exe/.test(install))) {
    fail('INVALID_INPUT', 'Install must distinguish PowerShell and cmd.exe');
  }
  if (/\btar\s+-|\bcd\s+|<platform>/i.test(install)) {
    fail('INVALID_INPUT', 'Install must not include archive extraction, directory-change or platform-placeholder commands');
  }
  const runSection = section(notes, 'Run');
  if (!/From a project directory/.test(runSection)
    || !/(?:outask|tasks) create\b/.test(runSection) || !/(?:outask|tasks) list\b/.test(runSection)) {
    fail('INVALID_INPUT', 'Run must demonstrate general create and list use from a project directory');
  }
  const documentation = section(notes, 'Documentation');
  for (const label of ['Basic use', 'Full operator reference', 'MCP setup']) {
    if (!documentation.includes(`[${label}](`)) fail('INVALID_INPUT', `Documentation must link ${label}`);
  }
  return { notes: approved };
}
