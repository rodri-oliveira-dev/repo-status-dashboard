const DAY_MS = 86_400_000;

export const DEFAULT_URGENCY_THRESHOLDS = Object.freeze({ approachingDays: 90, monitorDays: 180 });

function dateState(date, asOf) {
  if (!date) return null;
  const timestamp = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(timestamp) ? timestamp < asOf : null;
}

export function migrationUrgency(
  eolDate,
  asOf = Date.now(),
  thresholds = DEFAULT_URGENCY_THRESHOLDS,
) {
  if (!eolDate) return { urgency: 'unknown', daysRemaining: null };
  const eol = Date.parse(`${eolDate}T00:00:00Z`);
  if (!Number.isFinite(eol)) return { urgency: 'unknown', daysRemaining: null };
  const daysRemaining = Math.ceil((eol - asOf) / DAY_MS);
  if (daysRemaining < 0) return { urgency: 'migration-required', daysRemaining };
  if (daysRemaining <= thresholds.approachingDays)
    return { urgency: 'migration-approaching', daysRemaining };
  if (daysRemaining <= thresholds.monitorDays) return { urgency: 'monitor', daysRemaining };
  return { urgency: 'no-immediate-action', daysRemaining };
}

export function adaptEndOfLifeDateProduct(payload) {
  if (!payload || !String(payload.schema_version ?? '').startsWith('1.')) {
    throw new Error('Unsupported endoflife.date API contract');
  }
  const product = payload.result;
  if (!product || !Array.isArray(product.releases) || typeof product.name !== 'string') {
    throw new Error('Invalid endoflife.date product response');
  }
  return {
    id: product.name,
    label: product.label ?? product.name,
    lastModified: payload.last_modified ?? null,
    sourceUrl: product.links?.html ?? `https://endoflife.date/${product.name}`,
    policyUrl: product.links?.releasePolicy ?? null,
    releases: product.releases.map((release) => ({
      cycle: String(release.name),
      label: release.label ?? String(release.name),
      releaseDate: release.releaseDate ?? null,
      lts: typeof release.isLts === 'boolean' ? release.isLts : null,
      ltsFrom: release.ltsFrom ?? null,
      activeSupportEnd: release.eoasFrom ?? null,
      eol: release.eolFrom ?? null,
      apiActiveEnded: typeof release.isEoas === 'boolean' ? release.isEoas : null,
      apiEol: typeof release.isEol === 'boolean' ? release.isEol : null,
      latest: release.latest?.name ?? null,
      latestDate: release.latest?.date ?? null,
    })),
  };
}

export function evaluateLifecycle(
  technology,
  version,
  cache,
  { asOf = Date.now(), thresholds = DEFAULT_URGENCY_THRESHOLDS, staleAfterHours = 48 } = {},
) {
  const base = {
    cycle: version.cycle,
    lifecycle: 'unknown',
    lts: technology.lifecycleProduct ? 'unknown' : 'not-applicable',
    activeSupportEnd: null,
    maintenanceSupportEnd: null,
    eol: null,
    daysRemaining: null,
    latestStable: null,
    migrationUrgency: 'unknown',
    source: null,
    sourceUpdatedAt: null,
    stale: false,
  };
  if (!technology.lifecycleProduct || !version.cycle || version.kind === 'range') return base;
  const product = cache?.products?.[technology.lifecycleProduct];
  if (!product) return base;
  const release = product.releases?.find((candidate) => candidate.cycle === version.cycle);
  // Freshness belongs to the product, not to the last successful cache refresh.
  const retrievedAt = product.retrievedAt ?? cache.updatedAt;
  const retrievedTime = Date.parse(retrievedAt ?? '');
  const cacheAge = Number.isFinite(retrievedTime)
    ? (asOf - retrievedTime) / 3_600_000
    : Number.POSITIVE_INFINITY;
  const source = {
    name: 'endoflife.date',
    url: product.sourceUrl,
    policyUrl: product.policyUrl,
  };
  if (!release)
    return {
      ...base,
      source,
      sourceUpdatedAt: product.lastModified,
      stale: cacheAge > staleAfterHours,
    };

  const eolPassed = dateState(release.eol, asOf) ?? release.apiEol;
  const activeEnded = dateState(release.activeSupportEnd, asOf) ?? release.apiActiveEnded;
  const lifecycle = eolPassed ? 'end-of-life' : activeEnded ? 'maintenance' : 'active';
  const urgency = migrationUrgency(release.eol, asOf, thresholds);
  return {
    cycle: release.cycle,
    lifecycle,
    lts: release.lts === true ? 'yes' : release.lts === false ? 'no' : 'unknown',
    activeSupportEnd: release.activeSupportEnd,
    maintenanceSupportEnd: release.eol,
    eol: release.eol,
    daysRemaining: urgency.daysRemaining,
    latestStable: release.latest,
    migrationUrgency: urgency.urgency,
    source,
    sourceUpdatedAt: product.lastModified,
    stale: cacheAge > staleAfterHours,
  };
}

export function buildTechnologyRadarSnapshot({ owner, repositories, cache, generatedAt }) {
  const asOf = Date.parse(generatedAt);
  const technologyRepositories = repositories.map((repository) => ({
    repository: {
      name: repository.name,
      fullName: repository.fullName,
      url: repository.url,
    },
    coverage: repository.technology.coverage,
    technologies: repository.technology.technologies.map((technology) => ({
      id: technology.id,
      name: technology.name,
      category: technology.category,
      versions: technology.versions.map((version) => ({
        ...version,
        lifecycle: evaluateLifecycle(technology, version, cache, { asOf }),
      })),
    })),
  }));
  const complete = technologyRepositories.filter(
    ({ coverage }) => coverage.status === 'complete',
  ).length;
  const partial = technologyRepositories.filter(
    ({ coverage }) => coverage.status === 'partial',
  ).length;
  const unavailable = technologyRepositories.length - complete - partial;
  return {
    schemaVersion: 1,
    owner,
    generatedAt,
    lifecycleUpdatedAt: cache?.updatedAt ?? null,
    sources: [
      {
        name: 'endoflife.date',
        url: 'https://endoflife.date/docs/api/v1/',
        retrievedAt: cache?.updatedAt ?? null,
        contractVersion: cache?.source?.schemaVersion ?? null,
      },
    ],
    urgencyThresholds: DEFAULT_URGENCY_THRESHOLDS,
    coverage: { repositories: technologyRepositories.length, complete, partial, unavailable },
    repositories: technologyRepositories,
  };
}
