import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { releaseNotes } from '../../scripts/release-notes.mjs';
import { targets } from '../../scripts/release-config.mjs';
import { approvedNotes, conciseNotes, openingSentence } from './helpers/release-fixture.mjs';

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'outask-notes-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, 'notes.md');
  return (notes, options = {}) => {
    writeFileSync(path, notes);
    return releaseNotes('1.6', '1.6.0', 'owner/project', targets, path, options).notes;
  };
}

test('concise notes accept LF and CRLF while retaining the exact approved bytes', t => {
  const validate = fixture(t), notes = conciseNotes('1.6');
  for (const text of [notes, notes.replaceAll('\n', '\r\n'), notes.replace(/(\.tar\.gz\))\n-/g, '$1\n\n-')]) assert.equal(validate(text), text);
});

test('candidate validation rejects invalid opening, sections, downloads and installation', t => {
  const validate = fixture(t), notes = conciseNotes('1.6');
  for (const invalid of [
    notes.replace(openingSentence, '# Outask v1.6'),
    notes.replace(openingSentence, 'A different product description.'),
    notes.replace("## What's new", '## Current version'),
    notes.replace('## Run', '## Install'),
    notes.replace(/- \[Linux x64\].*\n/, ''),
    notes.replace('Outask-1.6-linux-x64', 'Outask-1.5-linux-x64'),
    notes.replace('/owner/project/', '/other/project/'),
    notes.replace("## What's new", '- [SHA256SUMS](https://github.com/owner/project/releases/download/v1.6/SHA256SUMS)\n\n## What\'s new'),
    notes.replace('Node.js 22.23.3 or later', 'Node.js'),
    notes.replace('./Install.command', './install.sh'),
    notes.replace('./Install.cmd', './install.cmd'),
    notes.replace('extract the archive', 'download the archive'),
    notes.replace('open that directory', 'continue'),
    notes.replace('  # PowerShell', ''),
    notes.trimEnd(),
  ]) assert.throws(() => validate(invalid), undefined, invalid);
});

test('recovery accepts historical approved notes unchanged including published v1.5.1', t => {
  const validate = fixture(t);
  const legacy = approvedNotes('1.6');
  assert.throws(() => validate(legacy), /unheaded README opening sentence/);
  for (const text of [legacy, legacy.replaceAll('\n', '\r\n')]) assert.equal(validate(text, { recovery: true }), text);
  const path = new URL('./helpers/release-notes-v1.5.1.md', import.meta.url);
  const published = readFileSync(path, 'utf8');
  assert.equal(releaseNotes('1.5.1', '1.5.1', 'henryh/outask', targets, fileURLToPath(path), { recovery: true }).notes, published);
});
