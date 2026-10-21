import type {
  DetectedVersion,
  LifecycleInformation,
  RepositoryTechnology,
  TechnologyCategory,
  TechnologyScope,
  VersionKind,
} from '../models/technology-radar.model';

export interface TechnologyStackCard {
  readonly key: string;
  readonly name: string;
  readonly category: TechnologyCategory;
  readonly version: string;
  readonly kinds: readonly VersionKind[];
  readonly scopes: readonly TechnologyScope[];
  readonly declared: readonly string[];
  readonly resolved: readonly string[];
  readonly lifecycle: LifecycleInformation;
  readonly mismatches: readonly string[];
  readonly evidence: readonly { path: string; details: readonly string[] }[];
}

type EvidenceEntry = { path: string; details: Set<string> };

interface CardBuilder {
  key: string;
  name: string;
  category: TechnologyCategory;
  version: string;
  versions: DetectedVersion[];
  kinds: Set<VersionKind>;
  scopes: Set<TechnologyScope>;
  declared: Set<string>;
  resolved: Set<string>;
  mismatches: Set<string>;
  evidence: Map<string, EvidenceEntry>;
}

const kindPriority: Record<VersionKind, number> = {
  resolved: 0,
  declared: 1,
  range: 2,
  inferred: 3,
};

// This is a display projection. Keep the collected observations unchanged for the radar,
// where scopes, declaration types and individual occurrences have analytical meaning.
function rootOf(path: string): string {
  return path.slice(0, Math.max(0, path.lastIndexOf('/')));
}

function isLockVersion(version: DetectedVersion): boolean {
  return version.kind === 'resolved' && version.evidence.some((item) => item.kind === 'lockfile');
}

function isPackageDeclaration(version: DetectedVersion): boolean {
  return (
    (version.kind === 'declared' || version.kind === 'range') &&
    version.evidence.some((item) => /(^|\/)package\.json$/i.test(item.path))
  );
}

// Returns null for ranges we cannot evaluate reliably; never label them incompatible.
function compatibleDeclaration(declared: string, resolved: string): boolean | null {
  if (declared === resolved) return true;
  const actual = resolved.match(/^(\d+)\.(\d+)\.(\d+)(?:[-+][\w.-]+)?$/);
  if (!actual) return null;
  const lower = declared.match(/^([~^])(\d+)\.(\d+)(?:\.(\d+))?$/);
  if (!lower) return /^\d+(?:\.\d+){0,2}$/.test(declared) ? false : null;

  const numbers = actual.slice(1, 4).map(Number);
  const baseline = [Number(lower[2]), Number(lower[3]), Number(lower[4] ?? '0')];
  const compare = (a: readonly number[], b: readonly number[]): number => {
    for (let index = 0; index < 3; index += 1) {
      if (a[index] !== b[index]) return a[index] - b[index];
    }
    return 0;
  };
  const upper =
    lower[1] === '~'
      ? [baseline[0], baseline[1] + 1, 0]
      : baseline[0] > 0
        ? [baseline[0] + 1, 0, 0]
        : baseline[1] > 0
          ? [0, baseline[1] + 1, 0]
          : [0, 0, baseline[2] + 1];
  return compare(numbers, baseline) >= 0 && compare(numbers, upper) < 0;
}

function selectLifecycle(versions: readonly DetectedVersion[]): LifecycleInformation {
  const sorted = [...versions].sort(
    (a, b) =>
      Number(b.lifecycle.lifecycle !== 'unknown') - Number(a.lifecycle.lifecycle !== 'unknown') ||
      Number(a.lifecycle.stale) - Number(b.lifecycle.stale) ||
      kindPriority[a.kind] - kindPriority[b.kind],
  );
  return sorted[0].lifecycle;
}

function addVersion(card: CardBuilder, version: DetectedVersion): void {
  if (card.versions.includes(version)) return;
  card.versions.push(version);
  card.kinds.add(version.kind);
  card.scopes.add(version.scope);
  if (version.kind === 'resolved') card.resolved.add(version.value);
  else if (version.kind !== 'inferred') card.declared.add(version.value);
  for (const source of version.evidence) {
    let entry = card.evidence.get(source.path);
    if (!entry) {
      entry = { path: source.path, details: new Set() };
      card.evidence.set(source.path, entry);
    }
    entry.details.add(source.detail);
  }
}

function pairedVersions(
  declarations: readonly DetectedVersion[],
  lock: DetectedVersion,
): readonly DetectedVersion[] {
  const lockRoots = new Set(
    lock.evidence.filter((item) => item.kind === 'lockfile').map((item) => rootOf(item.path)),
  );
  return declarations.filter((declaration) =>
    declaration.evidence.some(
      (source) => /(^|\/)package\.json$/i.test(source.path) && lockRoots.has(rootOf(source.path)),
    ),
  );
}

export function buildRepositoryTechnologyStack(
  repository: RepositoryTechnology | null | undefined,
): readonly TechnologyStackCard[] {
  if (!repository) return [];
  const results: TechnologyStackCard[] = [];
  for (const technology of repository.technologies) {
    const cards = new Map<string, CardBuilder>();
    // The collector can coalesce evidence from multiple workspaces into one
    // DetectedVersion. Split by source before pairing to avoid cross-workspace joins.
    const observations = technology.versions.flatMap((version) =>
      version.evidence.length
        ? version.evidence.map((evidence) => ({ ...version, evidence: [evidence] }))
        : [version],
    );
    const declarations = observations.filter(isPackageDeclaration);
    const paired = new Set<DetectedVersion>();
    const ensureCard = (value: string): CardBuilder => {
      let card = cards.get(value);
      if (!card) {
        card = {
          key: technology.id + ':' + value,
          name: technology.name,
          category: technology.category,
          version: value,
          versions: [],
          kinds: new Set(),
          scopes: new Set(),
          declared: new Set(),
          resolved: new Set(),
          mismatches: new Set(),
          evidence: new Map(),
        };
        cards.set(value, card);
      }
      return card;
    };

    // Lockfiles and manifests in the same workspace describe one installation.
    // A mismatched declared range must remain visible, not become a second card.
    for (const lock of observations.filter(isLockVersion)) {
      const card = ensureCard(lock.value);
      addVersion(card, lock);
      for (const declaration of pairedVersions(declarations, lock)) {
        paired.add(declaration);
        addVersion(card, declaration);
        if (compatibleDeclaration(declaration.value, lock.value) === false) {
          card.mismatches.add(
            'Declared ' + declaration.value + ' does not match resolved ' + lock.value,
          );
        }
      }
    }

    // Merge identical versions across production, test, tooling and evidence kinds.
    // Do not merge merely by major lifecycle cycle: 10.0 and 10.1 remain distinct.
    for (const version of observations) {
      if (paired.has(version)) continue;
      addVersion(ensureCard(version.value), version);
    }

    for (const card of cards.values()) {
      results.push({
        key: card.key,
        name: card.name,
        category: card.category,
        version: card.version,
        kinds: [...card.kinds].sort((a, b) => kindPriority[a] - kindPriority[b]),
        scopes: [...card.scopes].sort(),
        declared: [...card.declared].sort(),
        resolved: [...card.resolved].sort(),
        lifecycle: selectLifecycle(card.versions),
        mismatches: [...card.mismatches].sort(),
        evidence: [...card.evidence.values()]
          .sort((a, b) => a.path.localeCompare(b.path))
          .map((item) => ({ path: item.path, details: [...item.details].sort() })),
      });
    }
  }
  return results.sort(
    (a, b) =>
      a.name.localeCompare(b.name) ||
      a.version.localeCompare(b.version, undefined, { numeric: true }),
  );
}
