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
export type WorkflowRole =
  | 'ci'
  | 'quality'
  | 'security'
  | 'mutation'
  | 'delivery'
  | 'release'
  | 'pages'
  | 'maintenance'
  | 'unknown';

export interface RepositoryCollection {
  readonly status: CollectionStatus;
  readonly confidence: CollectionConfidence;
  readonly collectedSignals: readonly string[];
  readonly unavailableSignals: readonly string[];
  readonly warnings: readonly string[];
}

export type HealthReasonCode =
  | 'REPOSITORY_ARCHIVED'
  | 'CI_FAILING'
  | 'DELIVERY_FAILING'
  | 'ACTIVITY_STALE'
  | 'CI_RUNNING'
  | 'CI_QUEUED'
  | 'CI_CANCELLED'
  | 'CI_UNKNOWN'
  | 'DELIVERY_IN_PROGRESS'
  | 'NO_DELIVERY_EVIDENCE'
  | 'COLLECTION_PARTIAL'
  | 'COLLECTION_UNAVAILABLE';

export interface HealthReason {
  readonly code: HealthReasonCode;
  readonly severity: 'critical' | 'warning' | 'info';
}

export interface StaleWorkItem {
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly updatedAt: string;
}

export interface StaleWorkItems {
  readonly thresholdDays: number;
  readonly issuesCount: number;
  readonly pullRequestsCount: number;
  readonly oldestIssues: readonly StaleWorkItem[];
  readonly oldestPullRequests: readonly StaleWorkItem[];
}

export type SecuritySignalStatus =
  'clean' | 'findings_present' | 'disabled' | 'not_configured' | 'unavailable';

export interface SecurityPosture {
  readonly dependabot: {
    readonly status: SecuritySignalStatus;
    readonly openAlerts: number | null;
    readonly highCritical: number | null;
  };
  readonly codeScanning: {
    readonly status: SecuritySignalStatus;
    readonly openAlerts: number | null;
    readonly highCritical: number | null;
  };
  readonly workflow: {
    readonly status: BuildStatus | 'not_configured' | 'unavailable';
    readonly name: string | null;
    readonly url: string | null;
    readonly date: string | null;
  };
  readonly openSsf: {
    readonly status: 'available' | 'not_configured' | 'unavailable';
    readonly score: number | null;
    readonly date: string | null;
    readonly url: string | null;
  };
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
  readonly openIssues: number | null;
  readonly openPullRequests: number | null;
  readonly staleWorkItems: StaleWorkItems | null;
  readonly security: SecurityPosture;
  readonly projectType: ProjectType;
  readonly lastCommitSha: string | null;
  readonly lastCommitDate: string | null;
  readonly lastWorkflowName: string | null;
  readonly lastWorkflowRole: WorkflowRole;
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
  readonly healthReasons: readonly HealthReason[];
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
