export function distributionVersion(packageVersion) {
  const match = /^(\d+)\.(\d+)\.(\d+)(.*)$/.exec(packageVersion);
  if (!match || Number(match[3]) !== 0) return packageVersion;
  return `${match[1]}.${match[2]}${match[4]}`;
}

// Release tags omit a zero patch; comparisons still follow SemVer precedence.
export function compareVersions(left, right) {
  const parse = value => {
    const match = /^(\d+)\.(\d+)(?:\.(\d+))?(?:-([\w.-]+))?(?:\+[\w.-]+)?$/.exec(value);
    if (!match) throw new Error(`Invalid Outask version ${value}`);
    return { core: match.slice(1, 4).map(part => BigInt(part ?? 0)), pre: match[4]?.split('.') };
  };
  const a = parse(left), b = parse(right);
  for (let i = 0; i < 3; i++) {
    if (a.core[i] !== b.core[i]) return a.core[i] > b.core[i] ? 1 : -1;
  }
  if (!a.pre || !b.pre) return a.pre ? -1 : b.pre ? 1 : 0;
  for (let i = 0; i < Math.max(a.pre.length, b.pre.length); i++) {
    const x = a.pre[i], y = b.pre[i];
    if (x === y) continue;
    if (x === undefined || y === undefined) return x === undefined ? -1 : 1;
    const nx = /^\d+$/.test(x), ny = /^\d+$/.test(y);
    if (nx && ny) return BigInt(x) > BigInt(y) ? 1 : -1;
    if (nx !== ny) return nx ? -1 : 1;
    return x > y ? 1 : -1;
  }
  return 0;
}
