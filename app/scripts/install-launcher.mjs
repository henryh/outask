import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { applicationRoot } from '../src/locations.mjs';

export const commandNames = ['outask', 'tasks'];
export const packageNames = ['outask', 'task-tracker-local'];

export function installLocations() {
  const destination = applicationRoot();
  return {
    bin: process.platform === 'win32' ? join(destination, 'commands') : join(process.env.HOME || homedir(), '.local/bin'),
    releases: dirname(destination), destination,
  };
}

export function windowsLauncher(entry) {
  // ASCII batch text survives legacy console code pages; Node decodes the path.
  const encoded = Buffer.from(entry, 'utf8').toString('base64');
  const bootstrap = `const p=Buffer.from('${encoded}','base64').toString('utf8');process.argv.splice(1,0,p);import(require('node:url').pathToFileURL(p).href).catch(e=>{console.error(e);process.exitCode=1});`;
  return `@echo off\r\nrem Outask managed launcher\r\nsetlocal DisableDelayedExpansion\r\nwhere.exe node >nul 2>nul\r\nif errorlevel 1 (\r\n  echo DEPENDENCY_MISSING: install Node.js 22.23.3 or later and put node on PATH 1>&2\r\n  exit /b 1\r\n)\r\nnode -e "${bootstrap}" -- %*\r\nexit /b %errorlevel%\r\n`;
}

export function launcherEntry(contents) {
  const match = contents.match(/Buffer\.from\('([A-Za-z0-9+/]+={0,2})','base64'\)/);
  if (!match) return undefined;
  const entry = Buffer.from(match[1], 'base64').toString('utf8');
  return contents === windowsLauncher(entry) ? entry : undefined;
}
