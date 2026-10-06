import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { isValidReleaseVersion } from './release-version.mjs';

describe('release version validation', () => {
  it('accepts valid SemVer release tags', () => {
    const validVersions = [
      'v0.0.0',
      'v1.2.3',
      'v1.2.3-alpha',
      'v1.2.3-alpha.1',
      'v1.2.3-0.3.7',
      'v1.2.3-x.7.z.92',
      'v1.2.3-alpha.1+build.001',
      'v1.2.3+20130313144700',
    ];

    for (const version of validVersions) {
      assert.equal(isValidReleaseVersion(version), true, version);
    }
  });

  it('rejects malformed and non-SemVer release tags', () => {
    const invalidVersions = [
      '',
      '1.2.3',
      'v1.2',
      'v01.2.3',
      'v1.02.3',
      'v1.2.03',
      'v1.2.3-01',
      'v1.2.3-.alpha',
      'v1.2.3-alpha.',
      'v1.2.3-alpha..1',
      'v1.2.3-alpha.+build',
      'v1.2.3+build.',
      'v1.2.3+build..1',
    ];

    for (const version of invalidVersions) {
      assert.equal(isValidReleaseVersion(version), false, version);
    }
  });
});
