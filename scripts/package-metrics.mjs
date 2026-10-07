function normalizeRepositoryUrl(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/^git\+/, '')
    .replace(/^git@github\.com:/, 'https://github.com/')
    .replace(/\.git$/, '')
    .replace(/\/$/, '');
}

function matchesRepository(value, fullName) {
  return normalizeRepositoryUrl(value) === `https://github.com/${fullName.toLowerCase()}`;
}

export function parseNpmManifest(source, fullName) {
  let manifest;
  try {
    manifest = JSON.parse(source);
  } catch {
    return { status: 'ambiguous', reason: 'package.json is not valid JSON' };
  }
  if (manifest.private === true || !manifest.name) return { status: 'none' };
  const repositoryUrl =
    typeof manifest.repository === 'string' ? manifest.repository : manifest.repository?.url;
  if (!matchesRepository(repositoryUrl, fullName))
    return { status: 'ambiguous', reason: 'npm package repository does not match' };
  return { status: 'verified', ecosystem: 'npm', id: manifest.name };
}

function xmlValue(source, element) {
  const match = source.match(new RegExp(`<${element}>([^<]+)</${element}>`, 'i'));
  return match?.[1]?.trim() ?? null;
}

export function parseNuGetProject(source, fullName) {
  const id = xmlValue(source, 'PackageId');
  if (!id) return { status: 'none' };
  const repositoryUrl = xmlValue(source, 'RepositoryUrl');
  if (!matchesRepository(repositoryUrl, fullName))
    return { status: 'ambiguous', reason: 'NuGet package repository does not match' };
  return { status: 'verified', ecosystem: 'nuget', id };
}

export function deduplicatePackageCandidates(candidates) {
  const seen = new Set();
  return candidates.filter((candidate) => {
    if (candidate.status !== 'verified') return true;
    const key = `${candidate.ecosystem}:${candidate.id.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
