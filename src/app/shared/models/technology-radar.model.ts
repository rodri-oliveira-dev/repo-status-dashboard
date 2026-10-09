export type TechnologyCategory = 'runtime' | 'framework' | 'tool' | 'language' | 'infrastructure';
export type VersionConfidence = 'high' | 'medium' | 'low';
export type VersionKind = 'declared' | 'resolved' | 'range' | 'inferred';
export type TechnologyScope = 'production' | 'test' | 'tooling' | 'unknown';
export type LifecyclePhase = 'active' | 'maintenance' | 'end-of-life' | 'unknown';
export type MigrationUrgency =
  'no-immediate-action' | 'monitor' | 'migration-approaching' | 'migration-required' | 'unknown';
export type LtsStatus = 'yes' | 'no' | 'unknown' | 'not-applicable';

export interface VersionEvidence {
  readonly path: string;
  readonly kind: 'manifest' | 'lockfile' | 'workflow';
  readonly detail: string;
}

export interface LifecycleInformation {
  readonly cycle: string | null;
  readonly lifecycle: LifecyclePhase;
  readonly lts: LtsStatus;
  readonly activeSupportEnd: string | null;
  readonly maintenanceSupportEnd: string | null;
  readonly eol: string | null;
  readonly daysRemaining: number | null;
  readonly latestStable: string | null;
  readonly migrationUrgency: MigrationUrgency;
  readonly source: {
    readonly name: string;
    readonly url: string;
    readonly policyUrl: string | null;
  } | null;
  readonly sourceUpdatedAt: string | null;
  readonly stale: boolean;
}

export interface DetectedVersion {
  readonly value: string;
  readonly cycle: string | null;
  readonly kind: VersionKind;
  readonly confidence: VersionConfidence;
  readonly scope: TechnologyScope;
  readonly evidence: readonly VersionEvidence[];
  readonly lifecycle: LifecycleInformation;
}

export interface Technology {
  readonly id: string;
  readonly name: string;
  readonly category: TechnologyCategory;
  readonly versions: readonly DetectedVersion[];
}

export interface TechnologyCoverage {
  readonly status: 'complete' | 'partial' | 'unavailable';
  readonly treeTruncated: boolean;
  readonly filesInspected: number;
  readonly issues: readonly string[];
}

export interface RepositoryTechnology {
  readonly repository: { readonly name: string; readonly fullName: string; readonly url: string };
  readonly coverage: TechnologyCoverage;
  readonly technologies: readonly Technology[];
}

export interface TechnologyRadarSnapshot {
  readonly schemaVersion: 1;
  readonly owner: string;
  readonly generatedAt: string;
  readonly lifecycleUpdatedAt: string | null;
  readonly sources: readonly {
    readonly name: string;
    readonly url: string;
    readonly retrievedAt: string | null;
    readonly contractVersion: string | null;
  }[];
  readonly urgencyThresholds: { readonly approachingDays: number; readonly monitorDays: number };
  readonly coverage: {
    readonly repositories: number;
    readonly complete: number;
    readonly partial: number;
    readonly unavailable: number;
  };
  readonly repositories: readonly RepositoryTechnology[];
}

export interface TechnologyInventoryRow {
  readonly key: string;
  readonly technologyId: string;
  readonly technology: string;
  readonly category: TechnologyCategory;
  readonly cycle: string | null;
  readonly version: string;
  readonly versionValues: readonly string[];
  readonly kinds: readonly VersionKind[];
  readonly lifecycle: LifecycleInformation;
  readonly repositories: readonly RepositoryTechnology[];
  readonly occurrences: readonly { repository: RepositoryTechnology; version: DetectedVersion }[];
}
