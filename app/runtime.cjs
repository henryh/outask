// Keep the preflight parseable on old Node versions and derive bounds from the manifest.
const range = require('./package.json').engines.node;
const current = process.versions.node.split('.').map(Number);
const supported = range.split(' || ').some(function (branch) {
  return branch.split(' ').every(function (bound) {
    const match = /^(>=|<)(\d+)(?:\.(\d+))?(?:\.(\d+))?$/.exec(bound);
    if (!match) return false;
    const version = [Number(match[2]), Number(match[3] || 0), Number(match[4] || 0)];
    let order = 0;
    for (let index = 0; index < 3 && !order; index += 1) order = current[index] - version[index];
    return match[1] === '>=' ? order >= 0 : order < 0;
  });
});
if (!supported) throw new Error('INCOMPATIBLE_RUNTIME: task-tracker requires Node.js ' + range + '; found ' + process.versions.node);
