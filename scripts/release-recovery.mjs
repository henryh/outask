#!/usr/bin/env node
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gate, verifyTag } from './release-pr.mjs';
import { run, tagName } from './release-config.mjs';
import { reportError } from '../app/scripts/output.mjs';

const prefix = 'Publish approved release #';
const requiredJobs = [
  'approval',
  ...['Node', 'macOS arm64 Node', 'Windows x64 Node'].flatMap((label) =>
    ['22.23.3', '24'].map((version) => `verify / ${label} ${version}`)),
  'archives / archives (ubuntu-latest, linux-x64)',
  'archives / archives (macos-15, macos-arm64)',
  'archives / archives (windows-2025, windows-x64)',
];

function api(path) {
  return JSON.parse(run('gh', ['api', path], { stdio: ['ignore', 'pipe', 'pipe'] }).stdout);
}

export function recoveryRequest(event, actors) {
  const pr = event.pull_request;
  if (!pr?.title.startsWith(prefix)) return null;
  const match = /^Publish approved release #([1-9]\d*) from run #([1-9]\d*)$/.exec(pr.title);
  if (!match) throw new Error('Recovery title must be Publish approved release #<PR> from run #<run>');
  const repo = event.repository;
  const owner = repo.owner.login.toLowerCase();
  const isOwner = (login) => login?.toLowerCase() === owner;
  if (repo.owner.type !== 'User' || !isOwner(pr.user?.login) || !isOwner(event.sender?.login)
    || !isOwner(actors.actor) || !isOwner(actors.triggeringActor)) {
    throw new Error('Only the repository owner may request and trigger release recovery');
  }
  if (pr.base.ref !== 'main' || pr.head.repo?.full_name !== repo.full_name || pr.merged || pr.state !== 'open') {
    throw new Error('Recovery requires an open same-repository PR targeting main');
  }
  if (Number(match[1]) === pr.number) throw new Error('Recovery must reference a previously merged release PR');
  return { pr: match[1], run: match[2] };
}

export function recoveryPlan(event, actors, read = api) {
  const request = recoveryRequest(event, actors);
  if (!request) return null;
  const repo = event.repository;
  const source = read(`repos/${repo.full_name}/pulls/${request.pr}`);
  if (!source.merged || source.base.ref !== 'main'
    || source.head.repo?.full_name !== repo.full_name
    || source.merged_by?.login?.toLowerCase() !== repo.owner.login.toLowerCase()
    || !/^Outask(?: AI)? v/.test(source.title)) {
    throw new Error('Recovery source must be an owner-merged same-repository release PR');
  }
  if (!/^[a-f0-9]{40}$/.test(source.merge_commit_sha)) throw new Error('Invalid approved merge revision');
  const sourceRun = read(`repos/${repo.full_name}/actions/runs/${request.run}`);
  if (sourceRun.repository.full_name !== repo.full_name || sourceRun.path !== '.github/workflows/release.yml'
    || sourceRun.event !== 'pull_request' || sourceRun.head_sha !== source.head.sha
    || sourceRun.status !== 'completed') {
    throw new Error('Recovery run must be the completed Release workflow for the approved PR revision');
  }
  const jobs = read(`repos/${repo.full_name}/actions/runs/${request.run}/jobs?per_page=100`);
  if (jobs.total_count !== jobs.jobs.length || requiredJobs.some((name) =>
    !jobs.jobs.some((job) => job.name === name && job.conclusion === 'success'))) {
    throw new Error('Recovery requires all original owner, merged-main and native archive gates to have passed');
  }
  return { ref: source.merge_commit_sha, run: request.run, event: { repository: repo, pull_request: source } };
}

export function verifyRecovery(event) {
  // Run from the original approved checkout, using corrected tooling from the PR.
  const approved = gate(event, true);
  if (!approved || approved.tag !== tagName()) throw new Error('Publisher version must match the approved release');
  verifyTag(approved.tag);
  return approved;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const mode = process.argv[2];
    if (process.argv.length !== 3 || !['plan', 'verify'].includes(mode)) throw new Error('Usage: node scripts/release-recovery.mjs plan|verify');
    if (mode === 'verify') {
      verifyRecovery(JSON.parse(readFileSync(join(process.env.RUNNER_TEMP, 'approved-release.json'), 'utf8')));
      console.log('Original release approval and annotated tag: PASS');
    } else {
      const plan = recoveryPlan(JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')), {
        actor: process.env.GITHUB_ACTOR, triggeringActor: process.env.GITHUB_TRIGGERING_ACTOR,
      });
      if (plan) writeFileSync(join(process.env.RUNNER_TEMP, 'approved-release.json'), JSON.stringify(plan.event));
      if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT,
        `recovery=${Boolean(plan)}\n${plan ? `approved_ref=${plan.ref}\nartifact_run=${plan.run}\n` : ''}`);
      console.log(plan ? `Approved release recovery plan: ${plan.ref} from run ${plan.run}` : 'No recovery requested');
    }
  } catch (error) {
    reportError(error);
    process.exitCode = 1;
  }
}
