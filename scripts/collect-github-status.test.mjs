import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { nextGithubPath, shouldIncludeRepository } from './collect-github-status.mjs';

describe('GitHub pagination', () => {
  it('follows next links for cursor and numbered pagination', () => {
    assert.equal(
      nextGithubPath(
        '<https://api.github.com/repositories/1/dependabot/alerts?after=cursor&per_page=100>; rel="next"',
      ),
      '/repositories/1/dependabot/alerts?after=cursor&per_page=100',
    );
    assert.equal(
      nextGithubPath(
        '<https://api.github.com/repositories/1/alerts?page=1>; rel="prev", <https://api.github.com/repositories/1/alerts?page=3>; rel="next"',
      ),
      '/repositories/1/alerts?page=3',
    );
    assert.equal(nextGithubPath(null), null);
  });

  it('rejects pagination links outside GitHub API', () => {
    assert.throws(
      () => nextGithubPath('<https://example.com/alerts?page=2>; rel="next"'),
      /Unexpected GitHub pagination origin/,
    );
  });
});

describe('repository inclusion', () => {
  const owner = 'rodri-oliveira-dev';
  const repository = (overrides = {}) => ({
    fork: false,
    archived: false,
    owner: { login: owner },
    ...overrides,
  });

  it('includes active owned repositories', () => {
    assert.equal(shouldIncludeRepository(repository(), owner), true);
  });

  it('excludes archived repositories', () => {
    assert.equal(shouldIncludeRepository(repository({ archived: true }), owner), false);
  });

  it('excludes private repositories', () => {
    assert.equal(shouldIncludeRepository(repository({ private: true }), owner), false);
    assert.equal(shouldIncludeRepository(repository({ visibility: 'private' }), owner), false);
  });

  it('excludes forks and repositories owned by another account', () => {
    assert.equal(shouldIncludeRepository(repository({ fork: true }), owner), false);
    assert.equal(
      shouldIncludeRepository(repository({ owner: { login: 'someone-else' } }), owner),
      false,
    );
  });
});
