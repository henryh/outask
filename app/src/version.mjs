export function distributionVersion(packageVersion) {
  const match = /^(\d+)\.(\d+)\.(\d+)(.*)$/.exec(packageVersion);
  if (!match || Number(match[3]) !== 0) return packageVersion;
  return `${match[1]}.${match[2]}${match[4]}`;
}
