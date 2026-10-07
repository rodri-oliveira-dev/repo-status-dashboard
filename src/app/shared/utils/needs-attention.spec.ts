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
    security: {
      dependabot: { status: 'clean', openAlerts: 0, highCritical: 0 },
      codeScanning: { status: 'clean', openAlerts: 0, highCritical: 0 },
      workflow: { status: 'not_configured', name: null, url: null, date: null },
      openSsf: { status: 'not_configured', score: null, date: null, url: null },
    },
    activity: {
      windowDays: 30,
      since: '2026-09-01T00:00:00Z',
      commits: 0,
      workflowRuns: 0,
      successfulCiRuns: 0,
      failedCiRuns: 0,
      releases: 0,
      deployments: 0,
    },
    deliveryFrequency: {
      windowDays: 30,
      releases: 0,
      deliveryEvents: 0,
      evidence: ['github_deployments', 'delivery_workflows', 'github_releases'],
      correlationMinutes: 30,
    },
    packages: { status: 'none', items: [] },
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

  it('surfaces aggregate high and critical security findings', () => {
    const items = rankNeedsAttention([
      repository({
        health: 'healthy',
        healthReasons: [],
        security: {
          dependabot: { status: 'findings_present', openAlerts: 3, highCritical: 2 },
          codeScanning: { status: 'clean', openAlerts: 0, highCritical: 0 },
          workflow: { status: 'passing', name: 'CodeQL', url: 'workflow', date: null },
          openSsf: { status: 'available', score: 8, date: null, url: 'scorecard' },
        },
      }),
    ]);
    expect(items[0].severity).toBe('critical');
    expect(items[0].reason).toContain('2 high/critical Dependabot');
  });

  it('preserves independent critical reasons for the same repository', () => {
    const items = rankNeedsAttention([
      repository({
        health: 'failed',
        healthReasons: [{ code: 'CI_FAILING', severity: 'critical' }],
        security: {
          dependabot: { status: 'findings_present', openAlerts: 1, highCritical: 1 },
          codeScanning: { status: 'clean', openAlerts: 0, highCritical: 0 },
          workflow: { status: 'passing', name: 'CodeQL', url: 'workflow', date: null },
          openSsf: { status: 'available', score: 8, date: null, url: 'scorecard' },
        },
      }),
    ]);
    expect(items.map((item) => item.reason)).toEqual([
      '1 high/critical Dependabot finding',
      'Primary CI is failing',
    ]);
  });

  it('sorts missing dates consistently after dated items', () => {
    const items = rankNeedsAttention([
      repository({ name: 'missing', lastWorkflowDate: null }),
      repository({ name: 'dated', lastWorkflowDate: '2026-01-01T00:00:00Z' }),
    ]);
    expect(items.map((item) => item.repository.name)).toEqual(['dated', 'missing']);
  });
});
