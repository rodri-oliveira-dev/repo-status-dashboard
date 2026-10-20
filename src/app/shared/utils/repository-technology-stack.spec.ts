import { describe, expect, it } from 'vitest';
import type {
  DetectedVersion,
  RepositoryTechnology,
  Technology,
  VersionKind,
  TechnologyScope,
} from '../models/technology-radar.model';
import { buildRepositoryTechnologyStack } from './repository-technology-stack';

const lifecycle = (state: 'unknown' | 'active' = 'active') => ({
  cycle: '10',
  lifecycle: state,
  lts: 'yes' as const,
  activeSupportEnd: null,
  maintenanceSupportEnd: null,
  eol: '2028-11-13',
  daysRemaining: 700,
  latestStable: null,
  migrationUrgency: 'no-immediate-action' as const,
  source: null,
  sourceUpdatedAt: null,
  stale: false,
});

function version(
  value: string,
  kind: VersionKind,
  scope: TechnologyScope,
  path: string,
  detail = 'Detected version',
): DetectedVersion {
  return {
    value,
    kind,
    scope,
    confidence: 'high',
    cycle: value.split('.')[0],
    lifecycle: lifecycle(),
    evidence: [{ path, kind: path.endsWith('package-lock.json') ? 'lockfile' : 'manifest', detail }],
  };
}

function snapshot(...technologies: Technology[]): RepositoryTechnology {
  return {
    repository: { name: 'example', fullName: 'owner/example', url: 'https://example.test' },
    coverage: { status: 'complete', treeTruncated: false, filesInspected: 10, issues: [] },
    technologies,
  };
}

function tech(
  id: string,
  name: string,
  category: Technology['category'],
  ...versions: DetectedVersion[]
): Technology {
  return { id, name, category, versions };
}

describe('repository technology stack presentation', () => {
  it('consolidates .NET 10.0 across production and test scopes without losing paths', () => {
    const stack = snapshot(
      tech(
        'dotnet',
        '.NET',
        'runtime',
        version('10.0', 'declared', 'production', 'src/App/App.csproj'),
        version('10.0', 'declared', 'test', 'tests/App.Tests/App.Tests.csproj'),
      ),
    );
    const cards = buildRepositoryTechnologyStack(stack);
    expect(cards).toHaveLength(1);
    expect(cards[0].version).toBe('10.0');
    expect(cards[0].scopes).toEqual(['production', 'test']);
    expect(cards[0].evidence.map(({ path }) => path)).toEqual([
      'src/App/App.csproj',
      'tests/App.Tests/App.Tests.csproj',
    ]);
  });

  it('keeps SDK, runtime and different exact versions distinct', () => {
    const cards = buildRepositoryTechnologyStack(
      snapshot(
        tech(
          'dotnet',
          '.NET',
          'runtime',
          version('10.0', 'declared', 'production', 'src/App.csproj'),
          version('10.1', 'declared', 'production', 'src/Preview.csproj'),
        ),
        tech(
          'dotnet-sdk',
          '.NET SDK',
          'tool',
          version('10.0.402', 'declared', 'unknown', 'global.json'),
        ),
      ),
    );
    expect(cards.map(({ key }) => key)).toEqual(['dotnet:10.0', 'dotnet:10.1', 'dotnet-sdk:10.0.402']);
  });

  it('merges matching TypeScript declared and lockfile versions with both sources', () => {
    const cards = buildRepositoryTechnologyStack(
      snapshot(
        tech(
          'typescript',
          'TypeScript',
          'tool',
          version('5.9.3', 'declared', 'test', 'extensions/vscode/package.json'),
          version('5.9.3', 'resolved', 'test', 'extensions/vscode/package-lock.json'),
        ),
      ),
    );
    expect(cards).toHaveLength(1);
    expect(cards[0].kinds).toEqual(['resolved', 'declared']);
    expect(cards[0].declared).toEqual(['5.9.3']);
    expect(cards[0].resolved).toEqual(['5.9.3']);
    expect(cards[0].evidence).toHaveLength(2);
    expect(cards[0].mismatches).toEqual([]);
  });

  it('groups a compatible declared semver range with its local resolved version', () => {
    const cards = buildRepositoryTechnologyStack(
      snapshot(
        tech(
          'typescript',
          'TypeScript',
          'tool',
          version('^5.9.0', 'range', 'test', 'package.json'),
          version('5.9.3', 'resolved', 'test', 'package-lock.json'),
        ),
      ),
    );
    expect(cards).toHaveLength(1);
    expect(cards[0].version).toBe('5.9.3');
    expect(cards[0].declared).toEqual(['^5.9.0']);
    expect(cards[0].mismatches).toEqual([]);
  });

  it('flags an incompatible declaration instead of hiding the difference', () => {
    const cards = buildRepositoryTechnologyStack(
      snapshot(
        tech(
          'typescript',
          'TypeScript',
          'tool',
          version('~6.0.2', 'range', 'test', 'package.json'),
          version('5.9.3', 'resolved', 'test', 'package-lock.json'),
        ),
      ),
    );
    expect(cards).toHaveLength(1);
    expect(cards[0].mismatches).toEqual(['Declared ~6.0.2 does not match resolved 5.9.3']);
  });

  it('preserves different installed versions in separate workspaces', () => {
    const cards = buildRepositoryTechnologyStack(
      snapshot(
        tech(
          'typescript',
          'TypeScript',
          'tool',
          version('^5.9.0', 'range', 'test', 'app/package.json'),
          version('^6.0.0', 'range', 'test', 'extension/package.json'),
          version('5.9.3', 'resolved', 'test', 'app/package-lock.json'),
          version('6.0.4', 'resolved', 'test', 'extension/package-lock.json'),
        ),
      ),
    );
    expect(cards).toHaveLength(2);
    expect(cards.find(({ version: value }) => value === '5.9.3')?.declared).toEqual(['^5.9.0']);
    expect(cards.find(({ version: value }) => value === '6.0.4')?.declared).toEqual(['^6.0.0']);
  });

  it('does not pair a declaration with an unrelated workspace lockfile', () => {
    const cards = buildRepositoryTechnologyStack(
      snapshot(
        tech(
          'typescript',
          'TypeScript',
          'tool',
          version('^5.9.0', 'range', 'test', 'app/package.json'),
          version('5.9.3', 'resolved', 'test', 'other/package-lock.json'),
        ),
      ),
    );
    expect(cards).toHaveLength(2);
  });

  it('handles collector-merged evidence from multiple workspaces independently', () => {
    const declared = {
      ...version('^5.9.0', 'range', 'test', 'app/package.json'),
      evidence: [
        { path: 'app/package.json', kind: 'manifest' as const, detail: 'TS dependency' },
        { path: 'other/package.json', kind: 'manifest' as const, detail: 'TS dependency' },
      ],
    };
    const cards = buildRepositoryTechnologyStack(
      snapshot(
        tech(
          'typescript',
          'TypeScript',
          'tool',
          declared,
          version('5.9.3', 'resolved', 'test', 'app/package-lock.json'),
          version('5.9.4', 'resolved', 'test', 'other/package-lock.json'),
        ),
      ),
    );
    expect(cards).toHaveLength(2);
    expect(cards.find(({ version: value }) => value === '5.9.3')?.evidence.map((item) => item.path)).toEqual([
      'app/package-lock.json',
      'app/package.json',
    ]);
    expect(cards.find(({ version: value }) => value === '5.9.4')?.evidence.map((item) => item.path)).toEqual([
      'other/package-lock.json',
      'other/package.json',
    ]);
  });

  it('deduplicates file paths while retaining distinct evidence details', () => {
    const v1 = version('10.0', 'declared', 'production', 'src/App.csproj', 'Target framework net10.0');
    const v2 = version('10.0', 'resolved', 'production', 'src/App.csproj', 'Central property net10.0');
    const original = snapshot(tech('dotnet', '.NET', 'runtime', v1, v2));
    const cards = buildRepositoryTechnologyStack(original);
    expect(cards).toHaveLength(1);
    expect(cards[0].evidence).toEqual([
      {
        path: 'src/App.csproj',
        details: ['Central property net10.0', 'Target framework net10.0'],
      },
    ]);
    expect(original.technologies[0].versions).toHaveLength(2);
  });

  it('prefers a known resolved lifecycle over unknown declaration status', () => {
    const declaration = {
      ...version('5.9.3', 'declared', 'test', 'package.json'),
      lifecycle: lifecycle('unknown'),
    };
    const cards = buildRepositoryTechnologyStack(
      snapshot(
        tech(
          'typescript',
          'TypeScript',
          'tool',
          declaration,
          version('5.9.3', 'resolved', 'test', 'package-lock.json'),
        ),
      ),
    );
    expect(cards[0].lifecycle.lifecycle).toBe('active');
  });

  it('returns an empty collection when technology data is unavailable', () => {
    expect(buildRepositoryTechnologyStack(null)).toEqual([]);
  });
});
