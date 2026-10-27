import { homedir } from 'node:os';
import { join } from 'node:path';

// Explicit XDG locations remain supported; packaged application files always
// use the platform application root, independently of cache/config overrides.
export function applicationRoot(env = process.env, platform = process.platform) {
  const home = platform === 'win32' ? env.USERPROFILE || homedir() : env.HOME || homedir();
  if (platform === 'win32') return join(env.LOCALAPPDATA || join(home, 'AppData/Local'), 'Programs/Outask');
  if (platform === 'darwin') return join(home, 'Library/Application Support/Outask');
  return join(home, '.local/share/outask');
}

export function configPath(env = process.env) {
  return env.XDG_CONFIG_HOME ? join(env.XDG_CONFIG_HOME, 'outask/config.json') : join(applicationRoot(env), 'config.json');
}

export function cacheRoot(env = process.env) {
  return env.XDG_CACHE_HOME ? join(env.XDG_CACHE_HOME, 'outask/cache') : join(applicationRoot(env), 'cache');
}
