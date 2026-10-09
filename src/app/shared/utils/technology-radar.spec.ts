import { describe, expect, it } from 'vitest';
import type { TechnologyRadarSnapshot } from '../models/technology-radar.model';
import {
  buildTechnologyInventory,
  filterTechnologyInventory,
  migrationWatch,
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
});
