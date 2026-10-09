import { describe, expect, it } from 'vitest';
import type { TechnologyRadarSnapshot } from '../models/technology-radar.model';
import {
  buildTechnologyInventory,
  filterTechnologyInventory,
  migrationWatch,
  positionRadarPoints,
  technologyRadarMetrics,
} from './technology-radar';

const lifecycle = (
  phase: 'active' | 'end-of-life',
  urgency: 'no-immediate-action' | 'migration-required',
  eol: string,
) => ({
  cycle: '1',
  lifecycle: phase,
  lts: 'yes' as const,
  activeSupportEnd: null,
  maintenanceSupportEnd: eol,
  eol,
  daysRemaining: urgency === 'migration-required' ? -4 : 300,
  latestStable: '1.2.3',
  migrationUrgency: urgency,
  source: { name: 'source', url: 'https://example.test', policyUrl: null },
  sourceUpdatedAt: '2026-01-01',
  stale: false,
});

const snapshot: TechnologyRadarSnapshot = {
  schemaVersion: 1,
  owner: 'owner',
  generatedAt: '2026-01-01',
  lifecycleUpdatedAt: '2026-01-01',
  sources: [],
  urgencyThresholds: { approachingDays: 90, monitorDays: 180 },
  coverage: { repositories: 2, complete: 2, partial: 0, unavailable: 0 },
  repositories: [
    {
      repository: { name: 'alpha', fullName: 'owner/alpha', url: 'https://example.test/alpha' },
      coverage: { status: 'complete', treeTruncated: false, filesInspected: 2, issues: [] },
      technologies: [
        {
          id: 'nodejs',
          name: 'Node.js',
          category: 'runtime',
          versions: [
            {
              value: '22',
              cycle: '22',
              kind: 'resolved',
              confidence: 'high',
              scope: 'production',
              evidence: [],
              lifecycle: lifecycle('active', 'no-immediate-action', '2027-01-01'),
            },
          ],
        },
      ],
    },
    {
      repository: { name: 'beta', fullName: 'owner/beta', url: 'https://example.test/beta' },
      coverage: { status: 'complete', treeTruncated: false, filesInspected: 1, issues: [] },
      technologies: [
        {
          id: 'dotnet',
          name: '.NET',
          category: 'runtime',
          versions: [
            {
              value: '6.0',
              cycle: '6.0',
              kind: 'declared',
              confidence: 'high',
              scope: 'production',
              evidence: [],
              lifecycle: lifecycle('end-of-life', 'migration-required', '2025-01-01'),
            },
          ],
        },
      ],
    },
  ],
};

describe('Technology Radar aggregations', () => {
  it('counts technologies, repositories, occurrences and lifecycle coverage without double counting', () => {
    expect(technologyRadarMetrics(snapshot)).toMatchObject({
      technologies: 2,
      repositories: 2,
      eolCycles: 1,
      lifecycleKnown: 2,
      lifecycleCoverage: 100,
    });
  });
  it('filters and sorts inventory rows', () => {
    const rows = buildTechnologyInventory(snapshot);
    const filtered = filterTechnologyInventory(rows, {
      query: 'beta',
      category: 'all',
      lifecycle: 'all',
      urgency: 'all',
      sort: 'repositories',
      direction: 'desc',
    });
    expect(filtered.map((row) => row.technology)).toEqual(['.NET']);
  });
  it('orders migration watch by urgency and excludes no-action rows', () => {
    expect(migrationWatch(buildTechnologyInventory(snapshot)).map((row) => row.technology)).toEqual(
      ['.NET'],
    );
  });

  it('consolidates semantic major cycles while preserving kinds, exact versions and repositories', () => {
    const consolidated: TechnologyRadarSnapshot = {
      ...snapshot,
      repositories: [
        ...snapshot.repositories,
        {
          repository: { name: 'gamma', fullName: 'owner/gamma', url: 'https://example.test/gamma' },
          coverage: { status: 'complete', treeTruncated: false, filesInspected: 2, issues: [] },
          technologies: [
            {
              id: 'typescript',
              name: 'TypeScript',
              category: 'tool',
              versions: [
                {
                  value: '~6.0.2',
                  cycle: '6',
                  kind: 'range',
                  confidence: 'medium',
                  scope: 'test',
                  evidence: [],
                  lifecycle: {
                    ...lifecycle('active', 'no-immediate-action', '2027-01-01'),
                    lifecycle: 'unknown',
                    lts: 'not-applicable',
                    migrationUrgency: 'unknown',
                  },
                },
                {
                  value: '5.9.3',
                  cycle: '5',
                  kind: 'declared',
                  confidence: 'medium',
                  scope: 'test',
                  evidence: [],
                  lifecycle: {
                    ...lifecycle('active', 'no-immediate-action', '2027-01-01'),
                    lifecycle: 'unknown',
                    lts: 'not-applicable',
                    migrationUrgency: 'unknown',
                  },
                },
                {
                  value: '5.9.3',
                  cycle: '5',
                  kind: 'resolved',
                  confidence: 'high',
                  scope: 'test',
                  evidence: [],
                  lifecycle: {
                    ...lifecycle('active', 'no-immediate-action', '2027-01-01'),
                    lifecycle: 'unknown',
                    lts: 'not-applicable',
                    migrationUrgency: 'unknown',
                  },
                },
              ],
            },
            {
              id: 'dotnet-sdk',
              name: '.NET SDK',
              category: 'tool',
              versions: ['10.0.100', '10.0.400', '10.0.401'].map((value) => ({
                value,
                cycle: '10',
                kind: 'declared' as const,
                confidence: 'high' as const,
                scope: 'tooling' as const,
                evidence: [],
                lifecycle: {
                  ...lifecycle('active', 'no-immediate-action', '2027-01-01'),
                  cycle: '10',
                },
              })),
            },
          ],
        },
      ],
    };
    const rows = buildTechnologyInventory(consolidated);
    const typescript5 = rows.find((row) => row.key === 'typescript:5')!;
    expect(typescript5.kinds).toEqual(['resolved', 'declared']);
    expect(typescript5.versionValues).toEqual(['5.9.3']);
    expect(typescript5.occurrences).toHaveLength(2);
    expect(rows.find((row) => row.key === 'typescript:6')?.versionValues).toEqual(['~6.0.2']);
    const sdk = rows.find((row) => row.key === 'dotnet-sdk:10')!;
    expect(sdk.versionValues).toEqual(['10.0.100', '10.0.400', '10.0.401']);
    expect(sdk.repositories).toHaveLength(1);
  });

  it('positions radar markers deterministically regardless of collection order', () => {
    const rows = buildTechnologyInventory(snapshot);
    const reversed = [...rows].reverse();
    expect(positionRadarPoints(rows)).toEqual(positionRadarPoints(reversed));
  });
});
