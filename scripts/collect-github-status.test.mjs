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

  it('includes active owned repositories', () => {
    assert.equal(
      shouldIncludeRepository(
        { fork: false, archived: false, owner: { login: owner } },
        owner,
      ),
      true,
    );
  });

  it('excludes archived repositories', () => {
    assert.equal(
      shouldIncludeRepository(
        { fork: false, archived: true, owner: { login: owner } },
        owner,
      ),
      false,
    );
  });

  it('excludes forks and repositories owned by another account', () => {
    assert.equal(
      shouldIncludeRepository(
        { fork: true, archived: false, owner: { login: owner } },
        owner,
      ),
      false,
    );
    assert.equal(
      shouldIncludeRepository(
        { fork: false, archived: false, owner: { login: 'someone-else' } },
        owner,
      ),
      false,
    );
  });
});
