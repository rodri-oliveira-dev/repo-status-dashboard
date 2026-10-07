import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  deduplicatePackageCandidates,
  parseNpmManifest,
  parseNuGetProject,
} from './package-metrics.mjs';

describe('package identity correlation', () => {
  it('verifies npm identity only with matching repository metadata', () => {
    assert.deepEqual(
      parseNpmManifest(
        JSON.stringify({
          name: '@owner/tool',
          repository: { url: 'git+https://github.com/owner/repo.git' },
        }),
        'owner/repo',
      ),
      { status: 'verified', ecosystem: 'npm', id: '@owner/tool' },
    );
  });

  it('distinguishes private, absent and ambiguous npm packages', () => {
    assert.equal(parseNpmManifest('{"private":true,"name":"tool"}', 'owner/repo').status, 'none');
    assert.equal(parseNpmManifest('{"name":"tool"}', 'owner/repo').status, 'ambiguous');
    assert.equal(parseNpmManifest('invalid', 'owner/repo').status, 'ambiguous');
  });

  it('verifies NuGet identity only with explicit matching metadata', () => {
    assert.deepEqual(
      parseNuGetProject(
        '<Project><PropertyGroup><PackageId>Owner.Tool</PackageId><RepositoryUrl>https://github.com/owner/repo</RepositoryUrl></PropertyGroup></Project>',
        'owner/repo',
      ),
      { status: 'verified', ecosystem: 'nuget', id: 'Owner.Tool' },
    );
    assert.equal(parseNuGetProject('<Project />', 'owner/repo').status, 'none');
    assert.equal(
      parseNuGetProject('<Project><PackageId>Tool</PackageId></Project>', 'owner/repo').status,
      'ambiguous',
    );
  });

  it('keeps multiple verified packages and removes duplicate identities', () => {
    assert.deepEqual(
      deduplicatePackageCandidates([
        { status: 'verified', ecosystem: 'nuget', id: 'A' },
        { status: 'verified', ecosystem: 'nuget', id: 'a' },
        { status: 'verified', ecosystem: 'nuget', id: 'B' },
      ]).map((candidate) => candidate.id),
      ['A', 'B'],
    );
  });
});
