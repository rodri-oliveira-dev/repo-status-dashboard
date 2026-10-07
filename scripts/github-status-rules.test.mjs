import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  calculateCollection,
  calculateHealth,
  classifyWorkflowRole,
  classifyProjectType,
  correlateReleaseVersion,
  inferDeliveryType,
  mapDeliveryStatus,
  selectBuildWorkflow,
  selectDeliveryWorkflow,
  summarizeCollection,
} from './github-status-rules.mjs';

describe('collection confidence', () => {
  it('is complete and high when every signal group was collected', () => {
    assert.deepEqual(
      calculateCollection({
        metadata: 'available',
        commits: 'available',
        actions: 'available',
        deployments: 'available',
        releases: 'available',
      }),
      {
        status: 'complete',
        confidence: 'high',
        collectedSignals: ['metadata', 'commits', 'actions', 'deployments', 'releases'],
        unavailableSignals: [],
        warnings: [],
      },
    );
  });

  it('distinguishes partial and unavailable collection deterministically', () => {
    const partial = calculateCollection({
      metadata: 'available',
      commits: 'available',
      actions: 'unavailable',
      deployments: 'unavailable',
      releases: 'available',
    });
    const unavailable = calculateCollection({
      metadata: 'unavailable',
      commits: 'unavailable',
      actions: 'unavailable',
      deployments: 'unavailable',
      releases: 'unavailable',
    });
    assert.equal(partial.status, 'partial');
    assert.equal(partial.confidence, 'medium');
    assert.equal(unavailable.status, 'unavailable');
    assert.equal(unavailable.confidence, 'low');
  });

  it('summarizes repository collection states', () => {
    assert.deepEqual(
      summarizeCollection([
        { collection: { status: 'complete' } },
        { collection: { status: 'partial' } },
        { collection: { status: 'unavailable' } },
      ]),
      { total: 3, complete: 1, partial: 1, unavailable: 1 },
    );
  });
});

const run = (name, updated_at, extra = {}) => ({
  name,
  path: `.github/workflows/${name.toLowerCase()}.yml`,
  updated_at,
  status: 'completed',
  conclusion: 'success',
  ...extra,
});

describe('build workflow selection', () => {
  it('selects the newest relevant CI workflow', () => {
    const result = selectBuildWorkflow([
      run('CI', '2026-10-01T10:00:00Z'),
      run('Build and test', '2026-10-02T10:00:00Z'),
      run('Release', '2026-10-03T10:00:00Z'),
    ]);
    assert.equal(result.name, 'Build and test');
  });

  it('does not treat Dependabot as the primary CI run', () => {
    const result = selectBuildWorkflow([
      run('CI', '2026-10-03T10:00:00Z', { actor: { login: 'dependabot[bot]' } }),
      run('Build and test', '2026-10-02T10:00:00Z'),
    ]);
    assert.equal(result.name, 'Build and test');
  });

  it('does not let auxiliary mutation or quality workflows override CI', () => {
    const result = selectBuildWorkflow([
      run('CI', '2026-10-01T10:00:00Z'),
      run('mutation-tests', '2026-10-03T10:00:00Z', { conclusion: 'cancelled' }),
      run('Sonar quality', '2026-10-04T10:00:00Z'),
    ]);
    assert.equal(result.name, 'CI');
  });

  it('returns no primary CI for ambiguous test names', () => {
    assert.equal(selectBuildWorkflow([run('Tests', '2026-10-01T10:00:00Z')]), null);
  });
});

describe('workflow semantic roles', () => {
  it('classifies representative workflow roles', () => {
    assert.equal(classifyWorkflowRole(run('CI', '2026-10-01T10:00:00Z')), 'ci');
    assert.equal(classifyWorkflowRole(run('Sonar quality', '2026-10-01T10:00:00Z')), 'quality');
    assert.equal(classifyWorkflowRole(run('CodeQL security', '2026-10-01T10:00:00Z')), 'security');
    assert.equal(classifyWorkflowRole(run('mutation-tests', '2026-10-01T10:00:00Z')), 'mutation');
    assert.equal(
      classifyWorkflowRole(run('Deploy application', '2026-10-01T10:00:00Z')),
      'delivery',
    );
    assert.equal(classifyWorkflowRole(run('Create Release', '2026-10-01T10:00:00Z')), 'release');
    assert.equal(classifyWorkflowRole(run('Deploy GitHub Pages', '2026-10-01T10:00:00Z')), 'pages');
    assert.equal(
      classifyWorkflowRole(run('Dependabot Updates', '2026-10-01T10:00:00Z')),
      'maintenance',
    );
    assert.equal(classifyWorkflowRole(run('Tests', '2026-10-01T10:00:00Z')), 'unknown');
  });
});

describe('delivery workflow selection and type', () => {
  it('selects a publish workflow and ignores CI-only runs', () => {
    assert.equal(
      selectDeliveryWorkflow([
        run('CI', '2026-10-03T10:00:00Z'),
        run('Publish NuGet', '2026-10-02T10:00:00Z'),
      ]).name,
      'Publish NuGet',
    );
  });

  it('classifies supported delivery types', () => {
    assert.equal(inferDeliveryType('Publish package to NuGet'), 'NuGet');
    assert.equal(inferDeliveryType('Deploy GitHub Pages'), 'GitHub Pages');
    assert.equal(inferDeliveryType('github-pages deployment'), 'GitHub Pages');
    assert.equal(inferDeliveryType('Push Docker image to GHCR'), 'Container');
    assert.equal(inferDeliveryType('terraform apply'), 'Terraform');
    assert.equal(inferDeliveryType('something else'), 'Unknown');
  });

  it('associates a release version only when timestamps are close', () => {
    const release = { tag_name: 'v2.1.0', published_at: '2026-10-06T10:05:00Z' };
    assert.equal(correlateReleaseVersion(release, '2026-10-06T10:00:00Z'), 'v2.1.0');
    assert.equal(correlateReleaseVersion(release, '2026-10-05T10:00:00Z'), null);
  });

  it('does not report an inactive deployment as a failure', () => {
    assert.equal(mapDeliveryStatus('inactive'), 'unknown');
  });
});

describe('health classification', () => {
  const recent = '2026-10-01T00:00:00Z';
  const now = Date.parse('2026-10-06T00:00:00Z');
  it('prioritizes archived repositories', () =>
    assert.equal(
      calculateHealth(
        {
          archived: true,
          buildStatus: 'failing',
          deliveryStatus: 'failure',
          lastActivityDate: recent,
        },
        now,
      ),
      'archived',
    ));
  it('marks failed CI or delivery as failed', () =>
    assert.equal(
      calculateHealth(
        {
          archived: false,
          buildStatus: 'passing',
          deliveryStatus: 'failure',
          lastActivityDate: recent,
        },
        now,
      ),
      'failed',
    ));
  it('marks repositories without recent activity as stale', () =>
    assert.equal(
      calculateHealth(
        {
          archived: false,
          buildStatus: 'passing',
          deliveryStatus: 'success',
          lastActivityDate: '2026-01-01T00:00:00Z',
        },
        now,
      ),
      'stale',
    ));
  it('marks recent passing builds as healthy', () =>
    assert.equal(
      calculateHealth(
        {
          archived: false,
          buildStatus: 'passing',
          deliveryStatus: 'none',
          lastActivityDate: recent,
        },
        now,
      ),
      'healthy',
    ));
  it('marks in-progress signals as warning', () =>
    assert.equal(
      calculateHealth(
        {
          archived: false,
          buildStatus: 'running',
          deliveryStatus: 'none',
          lastActivityDate: recent,
        },
        now,
      ),
      'warning',
    ));
  it('keeps missing signals unknown', () =>
    assert.equal(
      calculateHealth(
        {
          archived: false,
          buildStatus: 'unknown',
          deliveryStatus: 'none',
          lastActivityDate: recent,
        },
        now,
      ),
      'unknown',
    ));
});

describe('project type classification', () => {
  it('classifies common repository profiles', () => {
    assert.equal(
      classifyProjectType({ name: 'angular-template', language: 'TypeScript', topics: [] }),
      'Angular',
    );
    assert.equal(
      classifyProjectType({ name: 'CSF.Analyzers', language: 'C#', topics: ['roslyn-analyzer'] }),
      'Analyzer',
    );
    assert.equal(
      classifyProjectType({
        name: 'Repo2C4',
        description: 'A CLI tool',
        language: 'C#',
        topics: [],
      }),
      'CLI',
    );
    assert.equal(
      classifyProjectType({
        name: 'Dapper-FluentMap',
        description: 'Fluent mapping for Dapper with analyzers',
        language: 'C#',
        topics: ['dapper', 'source-generator'],
      }),
      'Library',
    );
  });
});
