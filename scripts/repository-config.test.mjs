import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { describe, it } from 'node:test';
import { decodeRepositoryConfig, parseRepositoryConfig } from './repository-config.mjs';

describe('repository dashboard configuration', () => {
  it('parses supported block and inline workflow lists', () => {
    assert.deepEqual(
      parseRepositoryConfig(`
workflows:
  ci:
    - ci.yml
    - build.yaml
  quality: [sonar.yml, mutation-tests.yml]
`),
      { workflows: { ci: ['ci.yml', 'build.yaml'], quality: ['sonar.yml', 'mutation-tests.yml'] } },
    );
  });

  it('rejects unsupported keys and unsafe workflow paths', () => {
    assert.throws(() => parseRepositoryConfig('secrets:\n  token: value'), /unsupported root key/);
    assert.throws(
      () => parseRepositoryConfig('workflows:\n  ci:\n    - ../ci.yml'),
      /workflow entries must be YAML file names/,
    );
  });

  it('decodes GitHub content responses', () => {
    const content = Buffer.from('workflows:\n  ci: [ci.yml]').toString('base64');
    assert.deepEqual(decodeRepositoryConfig({ encoding: 'base64', content }), {
      workflows: { ci: ['ci.yml'] },
    });
  });
});
