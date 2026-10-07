import { describe, expect, it } from 'vitest';
import type { RepositoryStatus } from '../models/repository-status.model';
import { calculatePortfolioInsights } from './portfolio-insights';

const repository = (overrides: Record<string, unknown> = {}) =>
  ({
    name: 'repo',
    archived: false,
    health: 'healthy',
    updatedAt: '2026-09-20T00:00:00Z',
    lastCommitDate: '2026-09-20T00:00:00Z',
    activity: {
      windowDays: 30,
      commits: 1,
      workflowRuns: 2,
      successfulCiRuns: 1,
      failedCiRuns: 1,
      releases: 1,
      deployments: 1,
    },
    deliveryFrequency: { releases: 1, deliveryEvents: 1 },
    ...overrides,
  }) as unknown as RepositoryStatus;

describe('portfolio insights', () => {
  it('uses observed CI runs as the visible success-rate denominator', () => {
    const result = calculatePortfolioInsights(
      [
        repository(),
        repository({
          name: 'second',
          activity: {
            windowDays: 30,
            commits: 0,
            workflowRuns: 1,
            successfulCiRuns: 2,
            failedCiRuns: 0,
            releases: 0,
            deployments: 0,
          },
          deliveryFrequency: { releases: 0, deliveryEvents: 0 },
        }),
      ],
      '2026-10-01T00:00:00Z',
    );
    expect(result.ciObservedRuns).toBe(4);
    expect(result.ciSuccessRate).toBe(75);
    expect(result.activeRepositories).toBe(2);
  });

  it('excludes missing data from totals and exposes coverage', () => {
    const result = calculatePortfolioInsights(
      [
        repository(),
        repository({
          name: 'unknown',
          activity: {
            windowDays: 30,
            commits: null,
            workflowRuns: null,
            successfulCiRuns: null,
            failedCiRuns: null,
            releases: null,
            deployments: null,
          },
          deliveryFrequency: { releases: null, deliveryEvents: null },
        }),
      ],
      '2026-10-01T00:00:00Z',
    );
    expect(result.activityCoverage).toBe(1);
    expect(result.releaseCoverage).toBe(1);
    expect(result.deliveryCoverage).toBe(1);
    expect(result.releases).toBe(1);
  });

  it('identifies repositories approaching and crossing the stale threshold', () => {
    const result = calculatePortfolioInsights(
      [
        repository({ name: 'approaching', lastCommitDate: '2026-07-20T00:00:00Z' }),
        repository({ name: 'stale', health: 'stale', lastCommitDate: '2026-01-01T00:00:00Z' }),
        repository({
          name: 'archived',
          archived: true,
          health: 'archived',
          lastCommitDate: '2020-01-01T00:00:00Z',
        }),
      ],
      '2026-10-01T00:00:00Z',
    );
    expect(result.approachingStale).toEqual(['approaching']);
    expect(result.stale).toEqual(['stale']);
    expect(result.healthDistribution.archived).toBe(1);
  });
});
