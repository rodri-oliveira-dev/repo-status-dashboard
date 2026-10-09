import type {
  LifecyclePhase,
  MigrationUrgency,
  TechnologyCategory,
  TechnologyInventoryRow,
  TechnologyRadarSnapshot,
} from '../models/technology-radar.model';

export interface TechnologyFilters {
  readonly query: string;
  readonly category: TechnologyCategory | 'all';
  readonly lifecycle: LifecyclePhase | 'all';
  readonly urgency: MigrationUrgency | 'all';
  readonly sort: 'technology' | 'eol' | 'repositories';
  readonly direction: 'asc' | 'desc';
}

export function buildTechnologyInventory(snapshot: TechnologyRadarSnapshot | null) {
  const rows = new Map<string, TechnologyInventoryRow>();
  for (const repository of snapshot?.repositories ?? []) {
    for (const technology of repository.technologies) {
      for (const version of technology.versions) {
        const key = `${technology.id}:${version.value}:${version.kind}`;
        const existing = rows.get(key);
        const repositories = existing?.repositories ?? [];
        rows.set(key, {
          key,
          technologyId: technology.id,
          technology: technology.name,
          category: technology.category,
          version: version.value,
          kind: version.kind,
          lifecycle: chooseLifecycle(existing?.lifecycle, version.lifecycle),
          repositories: repositories.some(
            (candidate) => candidate.repository.fullName === repository.repository.fullName,
          )
            ? repositories
            : [...repositories, repository],
          occurrences: [...(existing?.occurrences ?? []), { repository, version }],
        });
      }
    }
  }
  return [...rows.values()];
}

function chooseLifecycle(
  current: TechnologyInventoryRow['lifecycle'] | undefined,
  candidate: TechnologyInventoryRow['lifecycle'],
) {
  if (!current || current.lifecycle === 'unknown') return candidate;
  return current;
}

export function filterTechnologyInventory(
  rows: readonly TechnologyInventoryRow[],
  filters: TechnologyFilters,
) {
  const query = filters.query.trim().toLocaleLowerCase();
  const result = rows.filter(
    (row) =>
      (!query ||
        row.technology.toLocaleLowerCase().includes(query) ||
        row.version.toLocaleLowerCase().includes(query) ||
        row.repositories.some(({ repository }) =>
          repository.name.toLocaleLowerCase().includes(query),
        )) &&
      (filters.category === 'all' || row.category === filters.category) &&
      (filters.lifecycle === 'all' || row.lifecycle.lifecycle === filters.lifecycle) &&
      (filters.urgency === 'all' || row.lifecycle.migrationUrgency === filters.urgency),
  );
  const direction = filters.direction === 'asc' ? 1 : -1;
  return result.sort((left, right) => {
    let comparison = 0;
    if (filters.sort === 'technology')
      comparison =
        left.technology.localeCompare(right.technology) ||
        left.version.localeCompare(right.version);
    if (filters.sort === 'repositories')
      comparison = left.repositories.length - right.repositories.length;
    if (filters.sort === 'eol') {
      const leftDate = left.lifecycle.eol
        ? Date.parse(left.lifecycle.eol)
        : Number.POSITIVE_INFINITY;
      const rightDate = right.lifecycle.eol
        ? Date.parse(right.lifecycle.eol)
        : Number.POSITIVE_INFINITY;
      comparison = leftDate - rightDate;
      if (!Number.isFinite(leftDate) && !Number.isFinite(rightDate)) comparison = 0;
    }
    return comparison * direction;
  });
}

export function technologyRadarMetrics(snapshot: TechnologyRadarSnapshot | null) {
  const rows = buildTechnologyInventory(snapshot);
  const occurrences = rows.flatMap((row) => row.occurrences);
  const eligible = occurrences.filter(({ version }) => version.kind !== 'range');
  const known = eligible.filter(({ version }) => version.lifecycle.lifecycle !== 'unknown');
  return {
    technologies: new Set(rows.map((row) => row.technologyId)).size,
    repositories: snapshot?.repositories.length ?? 0,
    approachingCycles: rows.filter(
      (row) => row.lifecycle.migrationUrgency === 'migration-approaching',
    ).length,
    eolCycles: rows.filter((row) => row.lifecycle.lifecycle === 'end-of-life').length,
    lifecycleKnown: known.length,
    lifecycleEligible: eligible.length,
    lifecycleCoverage: eligible.length ? Math.round((known.length / eligible.length) * 100) : 0,
  };
}

const urgencyRank: Record<MigrationUrgency, number> = {
  'migration-required': 0,
  'migration-approaching': 1,
  monitor: 2,
  'no-immediate-action': 3,
  unknown: 4,
};

export function migrationWatch(rows: readonly TechnologyInventoryRow[]) {
  return rows
    .filter((row) =>
      ['migration-required', 'migration-approaching', 'monitor'].includes(
        row.lifecycle.migrationUrgency,
      ),
    )
    .sort(
      (left, right) =>
        urgencyRank[left.lifecycle.migrationUrgency] -
          urgencyRank[right.lifecycle.migrationUrgency] ||
        (left.lifecycle.daysRemaining ?? Number.POSITIVE_INFINITY) -
          (right.lifecycle.daysRemaining ?? Number.POSITIVE_INFINITY),
    );
}
