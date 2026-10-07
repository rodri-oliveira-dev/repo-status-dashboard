import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  analyzeOpenWorkItems,
  calculateCollection,
  calculateDeliveryFrequency,
  calculateHealth,
  calculateHealthAssessment,
  classifyWorkflowRole,
  classifyProjectType,
  countOpenWorkItems,
  correlateReleaseVersion,
  inferDeliveryType,
  mapDeliveryStatus,
  normalizeSecurityAlerts,
  paginateWindow,
  securityWorkflowEvidence,
  selectBuildWorkflow,
  selectDeliveryWorkflow,
  summarizeCollection,
  summarizeActivity,
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
        workItems: 'available',
        security: 'available',
        packages: 'available',
      }),
      {
        status: 'complete',
        confidence: 'high',
        collectedSignals: [
          'metadata',
          'commits',
          'actions',
          'deployments',
          'releases',
          'workItems',
          'security',
          'packages',
        ],
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
      workItems: 'unavailable',
      security: 'available',
      packages: 'unavailable',
    });
    const unavailable = calculateCollection({
      metadata: 'unavailable',
      commits: 'unavailable',
      actions: 'unavailable',
      deployments: 'unavailable',
      releases: 'unavailable',
      workItems: 'unavailable',
      security: 'unavailable',
      packages: 'unavailable',
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

describe('security posture normalization', () => {
  it('distinguishes clean, disabled, findings and missing configuration', () => {
    assert.deepEqual(normalizeSecurityAlerts([], 'enabled'), {
      status: 'clean',
      openAlerts: 0,
      highCritical: 0,
    });
    assert.deepEqual(normalizeSecurityAlerts([], 'disabled'), {
      status: 'clean',
      openAlerts: 0,
      highCritical: 0,
    });
    assert.deepEqual(normalizeSecurityAlerts(null, 'disabled'), {
      status: 'disabled',
      openAlerts: 0,
      highCritical: 0,
    });
    assert.deepEqual(normalizeSecurityAlerts(null, 'enabled'), {
      status: 'not_configured',
      openAlerts: 0,
      highCritical: 0,
    });
    assert.deepEqual(
      normalizeSecurityAlerts([
        { security_advisory: { severity: 'critical' } },
        { rule: { security_severity_level: 'low' } },
      ]),
      { status: 'findings_present', openAlerts: 2, highCritical: 1 },
    );
  });

  it('normalizes a security workflow independently from primary CI', () => {
    assert.deepEqual(
      securityWorkflowEvidence([
        run('CI', '2026-10-01T00:00:00Z'),
        run('CodeQL security', '2026-10-02T00:00:00Z'),
      ]),
      {
        status: 'passing',
        name: 'CodeQL security',
        url: null,
        date: '2026-10-02T00:00:00Z',
      },
    );
    assert.equal(securityWorkflowEvidence([]).status, 'not_configured');
  });
});

describe('open work item counts', () => {
  it('separates open issues and pull requests', () => {
    assert.deepEqual(countOpenWorkItems([{}, { pull_request: { url: 'pr' } }, {}]), {
      openIssues: 2,
      openPullRequests: 1,
    });
  });

  it('returns explicit zero counts for an empty repository', () => {
    assert.deepEqual(countOpenWorkItems([]), { openIssues: 0, openPullRequests: 0 });
  });

  it('detects stale open work strictly beyond the threshold', () => {
    const now = Date.parse('2026-10-01T00:00:00Z');
    const result = analyzeOpenWorkItems(
      [
        {
          number: 1,
          title: 'stale issue',
          state: 'open',
          updated_at: '2026-08-31T23:59:59Z',
          html_url: 'issue',
        },
        {
          number: 2,
          title: 'boundary',
          state: 'open',
          updated_at: '2026-09-01T00:00:00Z',
          html_url: 'boundary',
        },
        {
          number: 3,
          title: 'stale PR',
          state: 'open',
          updated_at: '2026-08-01T00:00:00Z',
          html_url: 'pr',
          pull_request: {},
        },
        {
          number: 4,
          title: 'closed',
          state: 'closed',
          updated_at: '2026-01-01T00:00:00Z',
          html_url: 'closed',
        },
        {
          number: 5,
          title: 'merged',
          state: 'open',
          merged_at: '2026-02-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
          html_url: 'merged',
          pull_request: {},
        },
      ],
      now,
    );
    assert.equal(result.staleWorkItems.issuesCount, 1);
    assert.equal(result.staleWorkItems.pullRequestsCount, 1);
    assert.equal(result.staleWorkItems.oldestPullRequests[0].number, 3);
    assert.equal(result.staleWorkItems.oldestIssues[0].number, 1);
  });
});

describe('bounded activity metrics', () => {
  const now = Date.parse('2026-10-01T00:00:00Z');
  it('counts only evidence inside the 30-day window', () => {
    assert.deepEqual(
      summarizeActivity(
        {
          commits: [
            { commit: { committer: { date: '2026-09-15T00:00:00Z' } } },
            { commit: { committer: { date: '2026-08-01T00:00:00Z' } } },
          ],
          workflowRuns: [
            run('CI', '2026-09-20T00:00:00Z'),
            run('CI', '2026-09-21T00:00:00Z', { conclusion: 'failure' }),
          ],
          deployments: [{ created_at: '2026-09-10T00:00:00Z' }],
          releases: [{ published_at: '2026-09-11T00:00:00Z', draft: false }],
          availability: { commits: true, actions: true, deployments: true, releases: true },
        },
        now,
      ),
      {
        windowDays: 30,
        since: '2026-09-01T00:00:00.000Z',
        commits: 1,
        workflowRuns: 2,
        successfulCiRuns: 1,
        failedCiRuns: 1,
        releases: 1,
        deployments: 1,
      },
    );
  });

  it('returns zero for empty data and null for unavailable sources', () => {
    const result = summarizeActivity(
      {
        commits: [],
        workflowRuns: [],
        deployments: [],
        releases: [],
        availability: { commits: true, actions: false, deployments: true, releases: false },
      },
      now,
    );
    assert.equal(result.commits, 0);
    assert.equal(result.workflowRuns, null);
    assert.equal(result.deployments, 0);
    assert.equal(result.releases, null);
  });

  it('paginates full recent pages and stops after a short page', async () => {
    const calls = [];
    const first = Array.from({ length: 100 }, (_, index) => ({
      id: index,
      updated_at: '2026-09-20T00:00:00Z',
    }));
    const result = await paginateWindow(
      async (page) => {
        calls.push(page);
        return page === 1 ? first : [{ id: 100, updated_at: '2026-09-19T00:00:00Z' }];
      },
      Date.parse('2026-09-01T00:00:00Z'),
      (item) => item.updated_at,
    );
    assert.equal(result.length, 101);
    assert.deepEqual(calls, [1, 2]);
  });
});

describe('release and deployment frequency', () => {
  const now = Date.parse('2026-10-01T00:00:00Z');
  it('deduplicates cross-source evidence inside the correlation window', () => {
    const result = calculateDeliveryFrequency(
      {
        workflowRuns: [run('Deploy', '2026-09-20T10:05:00Z')],
        deployments: [{ id: 1, created_at: '2026-09-20T10:00:00Z' }],
        releases: [{ id: 2, published_at: '2026-09-20T10:10:00Z', draft: false }],
        availability: { actions: true, deployments: true, releases: true },
      },
      now,
    );
    assert.equal(result.releases, 1);
    assert.equal(result.deliveryEvents, 1);
  });

  it('keeps independent same-source events and separate cross-source events', () => {
    const result = calculateDeliveryFrequency(
      {
        workflowRuns: [
          run('Deploy', '2026-09-20T10:00:00Z', { id: 1 }),
          run('Deploy', '2026-09-21T10:00:00Z', { id: 2 }),
        ],
        deployments: [],
        releases: [{ id: 3, published_at: '2026-09-25T10:00:00Z', draft: false }],
        availability: { actions: true, deployments: true, releases: true },
      },
      now,
    );
    assert.equal(result.deliveryEvents, 3);
  });

  it('correlates at most one event from each source into a delivery event', () => {
    const result = calculateDeliveryFrequency(
      {
        workflowRuns: [
          run('Deploy', '2026-09-20T10:05:00Z', { id: 1 }),
          run('Deploy', '2026-09-20T10:10:00Z', { id: 2 }),
        ],
        deployments: [{ id: 3, created_at: '2026-09-20T10:00:00Z' }],
        releases: [],
        availability: { actions: true, deployments: true, releases: true },
      },
      now,
    );
    assert.equal(result.deliveryEvents, 2);
  });

  it('renders incomplete delivery evidence as unavailable instead of zero', () => {
    const result = calculateDeliveryFrequency(
      {
        workflowRuns: [],
        deployments: [],
        releases: [],
        availability: { actions: false, deployments: true, releases: true },
      },
      now,
    );
    assert.equal(result.releases, 0);
    assert.equal(result.deliveryEvents, null);
  });

  it('does not count successful Dependabot package updates as delivery events', () => {
    const result = calculateDeliveryFrequency(
      {
        workflowRuns: [
          run('nuget in /. - Update #1610204674', '2026-09-20T10:00:00Z', {
            id: 4,
            path: 'dynamic/dependabot/dependabot-updates',
            actor: { login: 'dependabot[bot]' },
            triggering_actor: { login: 'dependabot[bot]' },
          }),
        ],
        deployments: [],
        releases: [],
        availability: { actions: true, deployments: true, releases: true },
      },
      now,
    );
    assert.equal(result.deliveryEvents, 0);
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

  it('keeps legitimate CI when its title or branch merely contains dependabot', () => {
    const latest = run('CI', '2026-10-07T00:06:55Z', {
      actor: { login: 'rodri-oliveira-dev' },
      triggering_actor: { login: 'rodri-oliveira-dev' },
      display_title:
        'Merge pull request #47 from rodri-oliveira-dev/fix/dependabot-opentelemetry-version-trains',
      head_branch: 'main',
    });
    const result = selectBuildWorkflow([
      run('Build and test', '2026-10-06T23:55:37Z'),
      latest,
    ]);
    assert.equal(result, latest);
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
    assert.equal(
      classifyWorkflowRole(
        run('nuget in /. - Update #1610204674', '2026-10-05T12:17:18Z', {
          path: 'dynamic/dependabot/dependabot-updates',
          actor: { login: 'dependabot[bot]' },
          triggering_actor: { login: 'dependabot[bot]' },
          conclusion: 'failure',
        }),
      ),
      'maintenance',
    );
    assert.equal(classifyWorkflowRole(run('Tests', '2026-10-01T10:00:00Z')), 'unknown');
  });

  it('preserves a specific workflow role when the run title looks like CI', () => {
    assert.equal(
      classifyWorkflowRole(
        run('CodeQL', '2026-10-01T10:00:00Z', { display_title: 'ci: update analysis' }),
      ),
      'security',
    );
    assert.equal(
      classifyWorkflowRole(
        run('Release', '2026-10-01T10:00:00Z', {
          display_title: 'Release 1.0.0-ci.135136.1',
        }),
      ),
      'release',
    );
  });

  it('uses configured files authoritatively only for configured roles', () => {
    const configured = { ci: ['pipeline.yml'] };
    const namedCi = run('CI', '2026-10-01T10:00:00Z');
    const configuredCi = run('Anything', '2026-10-02T10:00:00Z', {
      path: '.github/workflows/pipeline.yml',
    });
    assert.equal(classifyWorkflowRole(namedCi, configured), 'unknown');
    assert.equal(classifyWorkflowRole(configuredCi, configured), 'ci');
    assert.equal(selectBuildWorkflow([namedCi, configuredCi], configured), configuredCi);
    assert.equal(
      classifyWorkflowRole(run('CodeQL security', '2026-10-01T10:00:00Z'), configured),
      'security',
    );
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

  it('does not treat Dependabot package updates as delivery', () => {
    const dependabotNuGet = run('nuget in /. - Update #1610204674', '2026-10-05T12:17:18Z', {
      path: 'dynamic/dependabot/dependabot-updates',
      actor: { login: 'dependabot[bot]' },
      triggering_actor: { login: 'dependabot[bot]' },
      conclusion: 'failure',
    });
    assert.equal(selectDeliveryWorkflow([dependabotNuGet]), null);
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

  it('returns deterministic reasons for precedence and multiple failures', () => {
    assert.deepEqual(
      calculateHealthAssessment(
        {
          archived: false,
          buildStatus: 'failing',
          deliveryStatus: 'failure',
          lastActivityDate: '2026-01-01T00:00:00Z',
          collectionStatus: 'partial',
        },
        now,
      ),
      {
        health: 'failed',
        reasons: [
          { code: 'CI_FAILING', severity: 'critical' },
          { code: 'DELIVERY_FAILING', severity: 'critical' },
          { code: 'ACTIVITY_STALE', severity: 'warning' },
          { code: 'COLLECTION_PARTIAL', severity: 'info' },
        ],
      },
    );
  });

  it('keeps collection degradation separate from repository health', () => {
    const result = calculateHealthAssessment(
      {
        archived: false,
        buildStatus: 'passing',
        deliveryStatus: 'success',
        lastActivityDate: recent,
        collectionStatus: 'partial',
      },
      now,
    );
    assert.equal(result.health, 'healthy');
    assert.deepEqual(result.reasons, [{ code: 'COLLECTION_PARTIAL', severity: 'info' }]);
  });
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
