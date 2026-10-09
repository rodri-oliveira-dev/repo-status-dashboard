const TEST_PATH = /(^|\/)(tests?|specs?|samples?|examples?|benchmarks?|fixtures?)(\/|$)/i;

const TECHNOLOGIES = {
  dotnet: { id: 'dotnet', name: '.NET', category: 'runtime', lifecycleProduct: 'dotnet' },
  'dotnet-sdk': {
    id: 'dotnet-sdk',
    name: '.NET SDK',
    category: 'tool',
    lifecycleProduct: 'dotnet',
  },
  nodejs: { id: 'nodejs', name: 'Node.js', category: 'runtime', lifecycleProduct: 'nodejs' },
  angular: { id: 'angular', name: 'Angular', category: 'framework', lifecycleProduct: 'angular' },
  typescript: {
    id: 'typescript',
    name: 'TypeScript',
    category: 'tool',
    lifecycleProduct: null,
  },
};

function scopeFor(path, dependencyGroup) {
  if (TEST_PATH.test(path) || dependencyGroup === 'devDependencies') return 'test';
  if (dependencyGroup === 'dependencies') return 'production';
  return 'unknown';
}

function kindFor(value) {
  const clean = String(value).trim();
  if (/^(?:v)?\d+(?:\.\d+){0,3}(?:[-+][\w.-]+)?$/.test(clean)) return 'declared';
  if (/[*xX]|[<>=~^|]/.test(clean) || /\s+-\s+/.test(clean)) return 'range';
  return 'inferred';
}

function cleanVersion(value) {
  const clean = String(value).trim();
  return clean.replace(/^v(?=\d)/i, '');
}

function cycleFor(technologyId, value) {
  const match = cleanVersion(value).match(/\d+(?:\.\d+)?/);
  if (!match) return null;
  const [major, minor] = match[0].split('.');
  return technologyId.startsWith('dotnet') ? `${major}.${minor ?? '0'}` : major;
}

function versionRecord({ technologyId, value, path, kind, confidence, scope, detail }) {
  const evidenceKind = /(^|\/)package-lock\.json$/i.test(path)
    ? 'lockfile'
    : /^\.github\/workflows\//i.test(path)
      ? 'workflow'
      : 'manifest';
  return {
    value: cleanVersion(value),
    cycle: cycleFor(technologyId, value),
    kind: kind ?? kindFor(value),
    confidence,
    scope,
    evidence: [{ path, kind: evidenceKind, detail }],
  };
}

function add(result, technologyId, version) {
  let technology = result.get(technologyId);
  if (!technology) {
    technology = { ...TECHNOLOGIES[technologyId], versions: [] };
    result.set(technologyId, technology);
  }
  const existing = technology.versions.find(
    (candidate) =>
      candidate.value === version.value &&
      candidate.kind === version.kind &&
      candidate.scope === version.scope,
  );
  if (existing) existing.evidence.push(...version.evidence);
  else technology.versions.push(version);
}

function parseJson(content) {
  try {
    return { value: JSON.parse(content), error: null };
  } catch (error) {
    return { value: null, error: error instanceof Error ? error.message : String(error) };
  }
}

function xmlProperties(content) {
  const properties = new Map();
  for (const match of content.matchAll(/<([A-Za-z][\w.]*)\b[^>]*>([^<]*)<\/\1>/g)) {
    properties.set(match[1], match[2].trim());
  }
  return properties;
}

function resolveProperty(value, properties) {
  let resolved = value;
  for (let pass = 0; pass < 5; pass += 1) {
    const next = resolved.replace(/\$\(([^)]+)\)/g, (token, name) => properties.get(name) ?? token);
    if (next === resolved) break;
    resolved = next;
  }
  return resolved.includes('$(') ? null : resolved;
}

function directoryOf(path) {
  const index = path.lastIndexOf('/');
  return index < 0 ? '' : path.slice(0, index);
}

function ancestors(path) {
  const result = [''];
  const segments = directoryOf(path).split('/').filter(Boolean);
  let current = '';
  for (const segment of segments) {
    current = current ? `${current}/${segment}` : segment;
    result.push(current);
  }
  return result;
}

function detectDotnet(files, result, issues) {
  const central = files.filter((file) =>
    /(^|\/)Directory\.Build\.(props|targets)$/i.test(file.path),
  );
  const globals = files.filter((file) => /(^|\/)global\.json$/i.test(file.path));
  for (const file of globals) {
    const parsed = parseJson(file.content);
    const value = parsed.value?.sdk?.version;
    if (typeof value === 'string') {
      add(
        result,
        'dotnet-sdk',
        versionRecord({
          technologyId: 'dotnet-sdk',
          value,
          path: file.path,
          kind: 'declared',
          confidence: 'high',
          scope: scopeFor(file.path),
          detail: '.NET SDK version from global.json',
        }),
      );
    } else if (parsed.error) issues.push(`${file.path}: invalid JSON`);
  }

  for (const file of files.filter((candidate) =>
    candidate.path.toLowerCase().endsWith('.csproj'),
  )) {
    const properties = new Map();
    for (const directory of ancestors(file.path)) {
      const prefix = directory ? `${directory}/` : '';
      for (const centralFile of central.filter((candidate) =>
        [`${prefix}Directory.Build.props`, `${prefix}Directory.Build.targets`]
          .map((path) => path.toLowerCase())
          .includes(candidate.path.toLowerCase()),
      )) {
        for (const [name, value] of xmlProperties(centralFile.content)) properties.set(name, value);
      }
    }
    for (const [name, value] of xmlProperties(file.content)) properties.set(name, value);
    const raw = properties.get('TargetFrameworks') ?? properties.get('TargetFramework');
    if (!raw) {
      if (!/<Project\b/i.test(file.content)) issues.push(`${file.path}: invalid project XML`);
      continue;
    }
    const resolved = resolveProperty(raw, properties);
    if (!resolved) {
      issues.push(`${file.path}: TargetFramework contains an unresolved property`);
      continue;
    }
    for (const target of resolved
      .split(';')
      .map((item) => item.trim())
      .filter(Boolean)) {
      const match = target.match(/^net(?:coreapp|standard)?(\d+)(?:\.(\d+))?/i);
      if (!match) continue;
      const value = match[2]
        ? `${match[1]}.${match[2]}`
        : `${match[1][0]}.${match[1].slice(1) || '0'}`;
      add(
        result,
        'dotnet',
        versionRecord({
          technologyId: 'dotnet',
          value,
          path: file.path,
          kind: raw === resolved ? 'declared' : 'resolved',
          confidence: 'high',
          scope: scopeFor(file.path),
          detail: `Target framework ${target}`,
        }),
      );
    }
  }
}

function detectNodeFiles(files, result) {
  for (const file of files.filter((candidate) =>
    /(^|\/)(\.nvmrc|\.node-version)$/i.test(candidate.path),
  )) {
    const value = file.content.trim();
    if (!value) continue;
    add(
      result,
      'nodejs',
      versionRecord({
        technologyId: 'nodejs',
        value,
        path: file.path,
        confidence: 'high',
        scope: scopeFor(file.path),
        detail: `Node.js version from ${file.path.split('/').at(-1)}`,
      }),
    );
  }
  for (const file of files.filter((candidate) =>
    /^\.github\/workflows\/.*\.ya?ml$/i.test(candidate.path),
  )) {
    for (const match of file.content.matchAll(/node-version\s*:\s*['"]?([^'"\s#]+)/gi)) {
      add(
        result,
        'nodejs',
        versionRecord({
          technologyId: 'nodejs',
          value: match[1],
          path: file.path,
          confidence: 'medium',
          scope: 'tooling',
          detail: 'Node.js version used by a GitHub Actions workflow',
        }),
      );
    }
  }
}

function lockfileVersions(files) {
  const versions = new Map();
  for (const file of files.filter((candidate) =>
    /(^|\/)package-lock\.json$/i.test(candidate.path),
  )) {
    const parsed = parseJson(file.content).value;
    if (!parsed) continue;
    for (const packageName of ['@angular/core', 'typescript']) {
      const value = parsed.packages?.[`node_modules/${packageName}`]?.version;
      if (typeof value === 'string')
        versions.set(`${file.path}:${packageName}`, { value, path: file.path });
    }
  }
  return versions;
}

function detectPackageJson(files, result, issues) {
  const locks = lockfileVersions(files);
  for (const file of files.filter((candidate) => /(^|\/)package\.json$/i.test(candidate.path))) {
    const parsed = parseJson(file.content);
    if (!parsed.value) {
      issues.push(`${file.path}: invalid JSON`);
      continue;
    }
    const manifest = parsed.value;
    if (typeof manifest.engines?.node === 'string') {
      add(
        result,
        'nodejs',
        versionRecord({
          technologyId: 'nodejs',
          value: manifest.engines.node,
          path: file.path,
          confidence: 'medium',
          scope: scopeFor(file.path),
          detail: 'Compatible Node.js range from package.json engines',
        }),
      );
    }
    for (const [group, dependencies] of [
      ['dependencies', manifest.dependencies],
      ['devDependencies', manifest.devDependencies],
    ]) {
      if (!dependencies || typeof dependencies !== 'object') continue;
      for (const [packageName, technologyId] of [
        ['@angular/core', 'angular'],
        ['typescript', 'typescript'],
      ]) {
        const declared = dependencies[packageName];
        if (typeof declared !== 'string') continue;
        add(
          result,
          technologyId,
          versionRecord({
            technologyId,
            value: declared,
            path: file.path,
            confidence: 'medium',
            scope: scopeFor(file.path, group),
            detail: `${packageName} from ${group}`,
          }),
        );
        const root = directoryOf(file.path);
        const lock = [...locks.entries()].find(
          ([key]) => key === `${root ? `${root}/` : ''}package-lock.json:${packageName}`,
        )?.[1];
        if (lock) {
          add(
            result,
            technologyId,
            versionRecord({
              technologyId,
              value: lock.value,
              path: lock.path,
              kind: 'resolved',
              confidence: 'high',
              scope: scopeFor(file.path, group),
              detail: `${packageName} resolved by package-lock.json`,
            }),
          );
        }
      }
    }
  }
}

export function detectTechnologies(files, { treeTruncated = false } = {}) {
  const normalized = files
    .filter((file) => typeof file?.path === 'string' && typeof file?.content === 'string')
    .map((file) => ({ ...file, path: file.path.replaceAll('\\', '/') }));
  const result = new Map();
  const issues = [];
  detectDotnet(normalized, result, issues);
  detectNodeFiles(normalized, result);
  detectPackageJson(normalized, result, issues);
  return {
    technologies: [...result.values()].map((technology) => ({
      ...technology,
      versions: technology.versions.sort((left, right) => left.value.localeCompare(right.value)),
    })),
    coverage: {
      status: treeTruncated || issues.length ? 'partial' : 'complete',
      treeTruncated,
      filesInspected: normalized.length,
      issues,
    },
  };
}

export function isTechnologyEvidencePath(path) {
  return (
    /(^|\/)(package\.json|package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|\.nvmrc|\.node-version|global\.json|Directory\.Build\.(props|targets))$/i.test(
      path,
    ) ||
    /\.csproj$/i.test(path) ||
    /^\.github\/workflows\/.*\.ya?ml$/i.test(path)
  );
}
