export const HEALTH_STATUSES = [
  'healthy',
  'warning',
  'failed',
  'stale',
  'archived',
  'unknown',
] as const;
export type HealthStatus = (typeof HEALTH_STATUSES)[number];

export const BUILD_STATUSES = [
  'passing',
  'failing',
  'running',
  'queued',
  'cancelled',
  'unknown',
] as const;
export type BuildStatus = (typeof BUILD_STATUSES)[number];

export const DELIVERY_TYPES = [
  'NuGet',
  'npm',
  'GitHub Pages',
  'GitHub Release',
  'Container',
  'Deployment',
  'Terraform',
  'None',
  'Unknown',
] as const;
export type DeliveryType = (typeof DELIVERY_TYPES)[number];

export const PROJECT_TYPES = [
  'Library',
  'CLI',
  'Analyzer',
  'Angular',
  'Application',
  'Infrastructure',
  'Template',
  'Documentation',
  'Sample',
  'Tool',
  'Unknown',
] as const;
export type ProjectType = (typeof PROJECT_TYPES)[number];

export type DeliveryStatus =
  'success' | 'failure' | 'running' | 'queued' | 'cancelled' | 'unknown' | 'none';

export type CollectionStatus = 'complete' | 'partial' | 'unavailable';
export type CollectionConfidence = 'high' | 'medium' | 'low';

export interface RepositoryCollection {
  readonly status: CollectionStatus;
  readonly confidence: CollectionConfidence;
  readonly collectedSignals: readonly string[];
  readonly unavailableSignals: readonly string[];
  readonly warnings: readonly string[];
}

export interface RepositoryStatus {
  readonly name: string;
  readonly fullName: string;
  readonly url: string;
  readonly description: string | null;
  readonly homepage: string | null;
  readonly language: string | null;
  readonly topics: readonly string[];
  readonly fork: false;
  readonly archived: boolean;
  readonly visibility: 'public' | 'private' | 'internal';
  readonly defaultBranch: string;
  readonly stars: number;
  readonly openIssues: number;
  readonly projectType: ProjectType;
  readonly lastCommitSha: string | null;
  readonly lastCommitDate: string | null;
  readonly lastWorkflowName: string | null;
  readonly lastWorkflowStatus: BuildStatus;
  readonly lastWorkflowConclusion: string | null;
  readonly lastWorkflowDate: string | null;
  readonly lastWorkflowUrl: string | null;
  readonly deliveryType: DeliveryType;
  readonly deliveryStatus: DeliveryStatus;
  readonly deliveryVersion: string | null;
  readonly deliveryDate: string | null;
  readonly deliveryUrl: string | null;
  readonly latestRelease: string | null;
  readonly latestReleaseDate: string | null;
  readonly latestReleaseUrl: string | null;
  readonly updatedAt: string;
  readonly health: HealthStatus;
  readonly collection: RepositoryCollection;
}

export interface RepositoryDataset {
  readonly schemaVersion: 2;
  readonly owner: string;
  readonly generatedAt: string;
  readonly repositories: readonly RepositoryStatus[];
  readonly collection: {
    readonly total: number;
    readonly complete: number;
    readonly partial: number;
    readonly unavailable: number;
  };
  readonly warnings?: readonly string[];
}
