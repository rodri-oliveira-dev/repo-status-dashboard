import type { HealthStatus, RepositoryStatus } from '../models/repository-status.model';

export interface PortfolioInsights {
  readonly windowDays: number;
  readonly totalRepositories: number;
  readonly activeRepositories: number;
  readonly activityCoverage: number;
  readonly ciSuccessful: number;
  readonly ciFailed: number;
  readonly ciObservedRuns: number;
  readonly ciSuccessRate: number | null;
  readonly releases: number;
  readonly releaseCoverage: number;
  readonly deliveryEvents: number;
  readonly deliveryCoverage: number;
  readonly approachingStale: readonly string[];
  readonly stale: readonly string[];
  readonly healthDistribution: Readonly<Record<HealthStatus, number>>;
}

export function calculatePortfolioInsights(
  repositories: readonly RepositoryStatus[],
  generatedAt: string,
): PortfolioInsights {
  const parsedNow = Date.parse(generatedAt);
  const now = Number.isFinite(parsedNow) && parsedNow > 0 ? parsedNow : null;
  const activityData = repositories.filter((repository) =>
    [
      repository.activity.commits,
      repository.activity.workflowRuns,
      repository.activity.releases,
      repository.activity.deployments,
    ].some((value) => value !== null),
  );
  const activeRepositories = activityData.filter((repository) =>
    [
      repository.activity.commits,
      repository.activity.workflowRuns,
      repository.activity.releases,
      repository.activity.deployments,
    ].some((value) => (value ?? 0) > 0),
  ).length;
  const ciRepositories = repositories.filter(
    (repository) =>
      repository.activity.successfulCiRuns !== null && repository.activity.failedCiRuns !== null,
  );
  const ciSuccessful = ciRepositories.reduce(
    (total, repository) => total + (repository.activity.successfulCiRuns ?? 0),
    0,
  );
  const ciFailed = ciRepositories.reduce(
    (total, repository) => total + (repository.activity.failedCiRuns ?? 0),
    0,
  );
  const ciObservedRuns = ciSuccessful + ciFailed;
  const releaseRepositories = repositories.filter(
    (repository) => repository.deliveryFrequency.releases !== null,
  );
  const deliveryRepositories = repositories.filter(
    (repository) => repository.deliveryFrequency.deliveryEvents !== null,
  );
  const ageDays = (repository: RepositoryStatus) => {
    const timestamp = Date.parse(repository.lastCommitDate ?? repository.updatedAt);
    return Number.isFinite(timestamp) && now !== null
      ? (now - timestamp) / (24 * 60 * 60 * 1000)
      : null;
  };
  const active = repositories.filter((repository) => !repository.archived);
  const distribution = Object.fromEntries(
    ['healthy', 'warning', 'failed', 'stale', 'archived', 'unknown'].map((health) => [
      health,
      repositories.filter((repository) => repository.health === health).length,
    ]),
  ) as Record<HealthStatus, number>;

  return {
    windowDays: repositories[0]?.activity.windowDays ?? 30,
    totalRepositories: repositories.length,
    activeRepositories,
    activityCoverage: activityData.length,
    ciSuccessful,
    ciFailed,
    ciObservedRuns,
    ciSuccessRate: ciObservedRuns ? (ciSuccessful / ciObservedRuns) * 100 : null,
    releases: releaseRepositories.reduce(
      (total, repository) => total + (repository.deliveryFrequency.releases ?? 0),
      0,
    ),
    releaseCoverage: releaseRepositories.length,
    deliveryEvents: deliveryRepositories.reduce(
      (total, repository) => total + (repository.deliveryFrequency.deliveryEvents ?? 0),
      0,
    ),
    deliveryCoverage: deliveryRepositories.length,
    approachingStale: active
      .filter((repository) => {
        const age = ageDays(repository);
        return age !== null && age > 60 && age <= 90;
      })
      .map((repository) => repository.name)
      .sort(),
    stale: active
      .filter((repository) => {
        const age = ageDays(repository);
        return age !== null && age > 90;
      })
      .map((repository) => repository.name)
      .sort(),
    healthDistribution: distribution,
  };
}
