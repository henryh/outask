import assert from 'node:assert/strict';
import { test } from 'node:test';
import { recoveryPlan, recoveryRequest } from '../../scripts/release-recovery.mjs';

function fixture() {
  const merge = 'a'.repeat(40), head = 'b'.repeat(40);
  const event = {
    repository: {full_name: 'owner/project', owner: {login: 'owner', type: 'User'}},
    sender: {login: 'owner'},
    pull_request: {number: 15, state: 'open', title: 'Publish approved release #14 from run #456', merged: false,
      user: {login: 'owner'}, base: {ref: 'main'}, head: {repo: {full_name: 'owner/project'}}},
  };
  const source = {merged: true, merge_commit_sha: merge, title: 'Outask v0.16',
    merged_by: {login: 'owner'}, base: {ref: 'main'}, head: {sha: head, repo: {full_name: 'owner/project'}}};
  const run = {repository: {full_name: 'owner/project'}, path: '.github/workflows/release.yml',
    event: 'pull_request', head_sha: head, status: 'completed'};
  const names = ['approval',
    'verify / Node 22.23.3', 'verify / Node 24',
    'verify / macOS arm64 Node 22.23.3', 'verify / macOS arm64 Node 24',
    'verify / Windows x64 Node 22.23.3', 'verify / Windows x64 Node 24',
    'archives / archives (ubuntu-latest, linux-x64)',
    'archives / archives (macos-15, macos-arm64)',
    'archives / archives (windows-2025, windows-x64)'];
  const jobs = {total_count: names.length, jobs: names.map(name => ({name, conclusion: 'success'}))};
  const responses = new Map([
    ['repos/owner/project/pulls/14', source],
    ['repos/owner/project/actions/runs/456', run],
    ['repos/owner/project/actions/runs/456/jobs?per_page=100', jobs],
  ]);
  const actors = {actor: 'owner', triggeringActor: 'owner'};
  const reads = [];
  const read = path => { reads.push(path); assert.ok(responses.has(path), path); return responses.get(path); };
  return {event, source, run, jobs, actors, read, reads, plan: () => recoveryPlan(event, actors, read)};
}

test('ordinary accumulating and new-release PRs do not opt into recovery', () => {
  const f = fixture();
  for (const title of ['Fix draft release metadata lookup', 'Outask v0.16']) {
    f.event.pull_request.title = title;
    assert.equal(f.plan(), null);
    assert.equal(f.reads.length, 0);
  }
});

test('explicit owner recovery selects original approved commit and original archive run', () => {
  const f = fixture(), result = f.plan();
  assert.equal(result.ref, f.source.merge_commit_sha);
  assert.equal(result.run, '456');
  assert.equal(result.event.pull_request, f.source);
  assert.equal(f.reads.length, 3);
});

test('contributors, contributor reruns, forks, other bases and self-recovery cannot publish', () => {
  const scenarios = [
    f => { f.event.sender.login = 'contributor'; },
    f => { f.event.pull_request.user.login = 'contributor'; },
    f => { f.actors.actor = 'contributor'; },
    f => { f.actors.triggeringActor = 'contributor'; },
    f => { f.event.pull_request.head.repo.full_name = 'fork/project'; },
    f => { f.event.pull_request.base.ref = 'dev'; },
    f => { f.event.pull_request.merged = true; },
    f => { f.event.pull_request.state = 'closed'; },
    f => { f.event.pull_request.number = 14; },
    f => { f.event.repository.owner.type = 'Organization'; },
  ];
  for (const change of scenarios) {
    const f = fixture(); change(f);
    assert.throws(f.plan);
    assert.equal(f.reads.length, 0);
  }
});

test('recovery titles require explicit PR and run numbers', () => {
  const f = fixture();
  f.event.pull_request.title = 'Publish approved release #14';
  assert.throws(() => recoveryRequest(f.event, f.actors), /Recovery title must/);
});

test('unmerged/unapproved sources and unrelated workflow runs cannot recover', () => {
  for (const change of [
    f => { f.source.merged = false; },
    f => { f.source.merged_by.login = 'contributor'; },
    f => { f.source.head.repo.full_name = 'fork/project'; },
    f => { f.source.title = 'Ordinary task'; },
    f => { f.run.head_sha = 'c'.repeat(40); },
    f => { f.run.path = '.github/workflows/pr-ci.yml'; },
    f => { f.run.event = 'push'; },
    f => { f.run.repository.full_name = 'other/project'; },
    f => { f.run.status = 'in_progress'; },
  ]) {
    const f = fixture(); change(f);
    assert.throws(f.plan);
  }
});

test('every original approval/main/archive gate must pass, with complete job metadata', () => {
  const original = fixture();
  for (let i = 0; i < original.jobs.jobs.length; i++) {
    const f = fixture(); f.jobs.jobs[i].conclusion = 'failure';
    assert.throws(f.plan, /requires all original/);
  }
  for (const change of [
    f => { f.jobs.jobs.pop(); f.jobs.total_count--; },
    f => { f.jobs.total_count++; },
  ]) {
    const f = fixture(); change(f);
    assert.throws(f.plan, /requires all original/);
  }
});
