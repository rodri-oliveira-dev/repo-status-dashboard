import type { HealthReason, RepositoryStatus } from '../models/repository-status.model';

export interface AttentionItem {
  readonly repository: RepositoryStatus;
  readonly reason: string;
  readonly severity: 'critical' | 'warning';
  readonly date: string | null;
  readonly externalUrl: string | null;
}

const REASON_LABELS: Partial<Record<HealthReason['code'], string>> = {
  CI_FAILING: 'Primary CI is failing',
  DELIVERY_FAILING: 'Latest delivery failed',
  ACTIVITY_STALE: 'Repository activity is stale',
  CI_RUNNING: 'Primary CI is still running',
  CI_QUEUED: 'Primary CI is queued',
  CI_CANCELLED: 'Primary CI was cancelled',
  CI_UNKNOWN: 'Primary CI status is unknown',
  DELIVERY_IN_PROGRESS: 'Delivery is pending or in progress',
  COLLECTION_UNAVAILABLE: 'Repository signals are unavailable',
};

function fromHealth(repository: RepositoryStatus): AttentionItem | null {
  if (repository.archived || repository.health === 'healthy') return null;
  const reason = repository.healthReasons.find((candidate) => REASON_LABELS[candidate.code]);
  if (!reason) return null;
  const workflowReason = reason.code.startsWith('CI_');
  const deliveryReason = reason.code.startsWith('DELIVERY_');
  return {
    repository,
    reason: REASON_LABELS[reason.code] ?? reason.code,
    severity: reason.severity === 'critical' ? 'critical' : 'warning',
    date:
      reason.code === 'ACTIVITY_STALE'
        ? repository.lastCommitDate
        : workflowReason
          ? repository.lastWorkflowDate
          : deliveryReason
            ? repository.deliveryDate
            : repository.updatedAt,
    externalUrl: workflowReason
      ? repository.lastWorkflowUrl
      : deliveryReason
        ? repository.deliveryUrl
        : repository.url,
  };
}

function fromStaleWork(repository: RepositoryStatus): AttentionItem | null {
  const stale = repository.staleWorkItems;
  if (!stale || (!stale.pullRequestsCount && !stale.issuesCount)) return null;
  const item = stale.oldestPullRequests[0] ?? stale.oldestIssues[0];
  const parts = [];
  if (stale.pullRequestsCount)
    parts.push(`${stale.pullRequestsCount} stale PR${stale.pullRequestsCount === 1 ? '' : 's'}`);
  if (stale.issuesCount)
    parts.push(`${stale.issuesCount} stale issue${stale.issuesCount === 1 ? '' : 's'}`);
  return {
    repository,
    reason: parts.join(' and '),
    severity: 'warning',
    date: item?.updatedAt ?? null,
    externalUrl: item?.url ?? repository.url,
  };
}

export function rankNeedsAttention(repositories: readonly RepositoryStatus[]): AttentionItem[] {
  return repositories
    .filter((repository) => !repository.archived)
    .map((repository) => fromHealth(repository) ?? fromStaleWork(repository))
    .filter((item): item is AttentionItem => item !== null)
    .sort((left, right) => {
      const severity = Number(left.severity === 'warning') - Number(right.severity === 'warning');
      if (severity) return severity;
      const date = Date.parse(left.date ?? '') - Date.parse(right.date ?? '');
      if (Number.isFinite(date) && date) return date;
      return left.repository.name.localeCompare(right.repository.name);
    });
}
