import type {
  DetectedVersion,
  LifecycleInformation,
  LifecyclePhase,
  MigrationUrgency,
  TechnologyCategory,
  TechnologyInventoryRow,
  TechnologyRadarSnapshot,
  VersionKind,
} from '../models/technology-radar.model';

export interface TechnologyFilters {
  readonly query: string;
  readonly category: TechnologyCategory | 'all';
  readonly lifecycle: LifecyclePhase | 'all';
  readonly urgency: MigrationUrgency | 'all';
  readonly sort: 'technology' | 'eol' | 'repositories';
  readonly direction: 'asc' | 'desc';
}

const kindOrder: Record<VersionKind, number> = {
  resolved: 0,
  declared: 1,
  range: 2,
  inferred: 3,
};

const urgencyRank: Record<MigrationUrgency, number> = {
  'migration-required': 0,
  'migration-approaching': 1,
  monitor: 2,
  'no-immediate-action': 3,
  unknown: 4,
};

function occurrenceKey(version: DetectedVersion) {
  return `${version.value}:${version.kind}:${version.scope}:${version.confidence}`;
}

function rowKey(technologyId: string, version: DetectedVersion) {
  return version.cycle
    ? `${technologyId}:${version.cycle}`
    : `${technologyId}:unclassified:${version.value}`;
}

function chooseLifecycle(
  current: LifecycleInformation | undefined,
  candidate: LifecycleInformation,
) {
  if (!current) return candidate;
  const preferred =
    urgencyRank[candidate.migrationUrgency] < urgencyRank[current.migrationUrgency]
      ? candidate
      : current;
  return current.stale || candidate.stale ? { ...preferred, stale: true } : preferred;
}

/** Canonical cycle aggregation shared by the table, radar, metrics and Migration Watch. */
export function buildTechnologyInventory(snapshot: TechnologyRadarSnapshot | null) {
  const rows = new Map<string, TechnologyInventoryRow>();
  const repositories = [...(snapshot?.repositories ?? [])].sort((left, right) =>
    left.repository.fullName.localeCompare(right.repository.fullName),
  );
  for (const repository of repositories) {
    const technologies = [...repository.technologies].sort((left, right) =>
      left.id.localeCompare(right.id),
    );
    for (const technology of technologies) {
      const versions = [...technology.versions].sort((left, right) =>
        occurrenceKey(left).localeCompare(occurrenceKey(right)),
      );
      for (const version of versions) {
        const key = rowKey(technology.id, version);
        const existing = rows.get(key);
        const rowRepositories = existing?.repositories ?? [];
        const versionValues = [
          ...new Set([...(existing?.versionValues ?? []), version.value]),
        ].sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
        const kinds = [...new Set([...(existing?.kinds ?? []), version.kind])].sort(
          (left, right) => kindOrder[left] - kindOrder[right],
        );
        rows.set(key, {
          key,
          technologyId: technology.id,
          technology: technology.name,
          category: technology.category,
          cycle: version.cycle,
          version: version.cycle ?? version.value,
          versionValues,
          kinds,
          lifecycle: chooseLifecycle(existing?.lifecycle, version.lifecycle),
          repositories: rowRepositories.some(
            (candidate) => candidate.repository.fullName === repository.repository.fullName,
          )
            ? rowRepositories
            : [...rowRepositories, repository],
          occurrences: [...(existing?.occurrences ?? []), { repository, version }],
        });
      }
    }
  }
  return [...rows.values()].sort(
    (left, right) =>
      left.technology.localeCompare(right.technology) ||
      left.version.localeCompare(right.version, undefined, { numeric: true }),
  );
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
        row.versionValues.some((value) => value.toLocaleLowerCase().includes(query)) ||
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
        left.version.localeCompare(right.version, undefined, { numeric: true });
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
  const eligible = occurrences.filter(
    ({ version }) => version.kind !== 'range' && version.lifecycle.lts !== 'not-applicable',
  );
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

export function migrationWatch(rows: readonly TechnologyInventoryRow[]) {
  return rows
    .filter(
      (row) => urgencyRank[row.lifecycle.migrationUrgency] < urgencyRank['no-immediate-action'],
    )
    .sort(
      (left, right) =>
        urgencyRank[left.lifecycle.migrationUrgency] -
          urgencyRank[right.lifecycle.migrationUrgency] ||
        (left.lifecycle.daysRemaining ?? Number.POSITIVE_INFINITY) -
          (right.lifecycle.daysRemaining ?? Number.POSITIVE_INFINITY) ||
        left.key.localeCompare(right.key),
    );
}

export type RadarQuadrant = 'platforms' | 'frameworks' | 'languages-tools' | 'infrastructure';

export interface RadarPoint {
  readonly row: TechnologyInventoryRow;
  readonly x: number;
  readonly y: number;
  readonly quadrant: RadarQuadrant;
  readonly ring: MigrationUrgency;
}

export function radarQuadrant(category: TechnologyCategory): RadarQuadrant {
  if (category === 'runtime') return 'platforms';
  if (category === 'framework') return 'frameworks';
  if (category === 'infrastructure') return 'infrastructure';
  return 'languages-tools';
}

const quadrantAngles: Record<RadarQuadrant, readonly [number, number]> = {
  platforms: [-88, -2],
  frameworks: [2, 88],
  'languages-tools': [92, 178],
  infrastructure: [182, 268],
};

const ringRadius: Record<MigrationUrgency, number> = {
  'no-immediate-action': 82,
  monitor: 150,
  'migration-approaching': 220,
  'migration-required': 290,
  unknown: 342,
};

/** Stable slots distribute peers inside each quadrant/ring without random movement. */
export function positionRadarPoints(
  rows: readonly TechnologyInventoryRow[],
): readonly RadarPoint[] {
  const groups = new Map<string, TechnologyInventoryRow[]>();
  for (const row of rows) {
    const quadrant = radarQuadrant(row.category);
    const key = `${quadrant}:${row.lifecycle.migrationUrgency}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const points: RadarPoint[] = [];
  for (const group of groups.values()) {
    group.sort((left, right) => left.key.localeCompare(right.key));
    const quadrant = radarQuadrant(group[0].category);
    const ring = group[0].lifecycle.migrationUrgency;
    const [start, end] = quadrantAngles[quadrant];
    group.forEach((row, index) => {
      const fraction = (index + 1) / (group.length + 1);
      const angle = ((start + (end - start) * fraction) * Math.PI) / 180;
      const radius = ringRadius[ring] + ((index % 3) - 1) * 10;
      points.push({
        row,
        quadrant,
        ring,
        x: Math.round((400 + Math.cos(angle) * radius) * 100) / 100,
        y: Math.round((400 + Math.sin(angle) * radius) * 100) / 100,
      });
    });
  }
  return points.sort((left, right) => left.row.key.localeCompare(right.row.key));
}
