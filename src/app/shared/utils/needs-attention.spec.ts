import { describe, expect, it } from 'vitest';
import type { RepositoryStatus } from '../models/repository-status.model';
import { rankNeedsAttention } from './needs-attention';

const repository = (overrides: Partial<RepositoryStatus>): RepositoryStatus =>
  ({
    name: 'repo',
    fullName: 'owner/repo',
    url: 'https://github.com/owner/repo',
    description: null,
    homepage: null,
    language: null,
    topics: [],
    fork: false,
    archived: false,
    visibility: 'public',
    defaultBranch: 'main',
    stars: 0,
    openIssues: 0,
    openPullRequests: 0,
    staleWorkItems: null,
    projectType: 'Application',
    lastCommitSha: null,
    lastCommitDate: '2026-09-01T00:00:00Z',
    lastWorkflowName: null,
    lastWorkflowRole: 'unknown',
    lastWorkflowStatus: 'unknown',
    lastWorkflowConclusion: null,
    lastWorkflowDate: null,
    lastWorkflowUrl: null,
    deliveryType: 'None',
    deliveryStatus: 'none',
    deliveryVersion: null,
    deliveryDate: null,
    deliveryUrl: null,
    latestRelease: null,
    latestReleaseDate: null,
    latestReleaseUrl: null,
    updatedAt: '2026-09-01T00:00:00Z',
    health: 'unknown',
    healthReasons: [{ code: 'CI_UNKNOWN', severity: 'warning' }],
    collection: {
      status: 'complete',
      confidence: 'high',
      collectedSignals: [],
      unavailableSignals: [],
      warnings: [],
    },
    ...overrides,
  }) as RepositoryStatus;

describe('needs attention ranking', () => {
  it('places failures before warnings and uses oldest date as tie-breaker', () => {
    const items = rankNeedsAttention([
      repository({
        name: 'warning',
        health: 'warning',
        healthReasons: [{ code: 'CI_CANCELLED', severity: 'warning' }],
      }),
      repository({
        name: 'failed',
        health: 'failed',
        healthReasons: [{ code: 'CI_FAILING', severity: 'critical' }],
      }),
    ]);
    expect(items.map((item) => item.repository.name)).toEqual(['failed', 'warning']);
  });

  it('surfaces stale work for otherwise healthy repositories', () => {
    const items = rankNeedsAttention([
      repository({
        health: 'healthy',
        healthReasons: [],
        staleWorkItems: {
          thresholdDays: 30,
          issuesCount: 1,
          pullRequestsCount: 0,
          oldestIssues: [
            { number: 1, title: 'old', url: 'issue', updatedAt: '2026-01-01T00:00:00Z' },
          ],
          oldestPullRequests: [],
        },
      }),
    ]);
    expect(items[0].reason).toBe('1 stale issue');
    expect(items[0].externalUrl).toBe('issue');
  });

  it('excludes archived repositories and collection-only degradation', () => {
    expect(
      rankNeedsAttention([
        repository({
          archived: true,
          health: 'archived',
          healthReasons: [{ code: 'REPOSITORY_ARCHIVED', severity: 'info' }],
        }),
        repository({
          health: 'healthy',
          healthReasons: [{ code: 'COLLECTION_PARTIAL', severity: 'info' }],
        }),
      ]),
    ).toEqual([]);
  });
});
