import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { detectTechnologies } from './technology-detection.mjs';

const detect = (...files) => detectTechnologies(files).technologies;
const technology = (result, id) => result.find((item) => item.id === id);

describe('technology detection', () => {
  it('detects single and multi-target .NET projects', () => {
    const result = detect(
      {
        path: 'src/App/App.csproj',
        content: '<Project><TargetFramework>net8.0</TargetFramework></Project>',
      },
      {
        path: 'src/Lib/Lib.csproj',
        content: '<Project><TargetFrameworks>net8.0;net9.0</TargetFrameworks></Project>',
      },
    );
    assert.deepEqual(
      technology(result, 'dotnet').versions.map(({ value }) => value),
      ['8.0', '9.0'],
    );
  });

  it('resolves centralized target framework properties and marks test projects', () => {
    const result = detect(
      {
        path: 'Directory.Build.props',
        content:
          '<Project><PropertyGroup><ProductTfm>net10.0</ProductTfm></PropertyGroup></Project>',
      },
      {
        path: 'tests/App.Tests/App.Tests.csproj',
        content: '<Project><TargetFramework>$(ProductTfm)</TargetFramework></Project>',
      },
    );
    const version = technology(result, 'dotnet').versions[0];
    assert.equal(version.value, '10.0');
    assert.equal(version.kind, 'resolved');
    assert.equal(version.scope, 'test');
  });

  it('keeps the .NET SDK tool distinct from target runtimes', () => {
    const result = detect(
      { path: 'global.json', content: JSON.stringify({ sdk: { version: '8.0.408' } }) },
      {
        path: 'App.csproj',
        content: '<Project><TargetFramework>net8.0</TargetFramework></Project>',
      },
    );
    assert.equal(technology(result, 'dotnet-sdk').category, 'tool');
    assert.equal(technology(result, 'dotnet-sdk').versions[0].cycle, '8.0');
    assert.equal(technology(result, 'dotnet').category, 'runtime');
  });

  it('detects Node.js declarations, ranges and workflow conflicts', () => {
    const result = detect(
      { path: '.nvmrc', content: '24.3.0\n' },
      { path: 'package.json', content: JSON.stringify({ engines: { node: '>=22 <25' } }) },
      { path: '.github/workflows/ci.yml', content: 'node-version: 22\n' },
    );
    const versions = technology(result, 'nodejs').versions;
    assert.equal(versions.length, 3);
    assert.equal(versions.find(({ value }) => value === '>=22 <25').kind, 'range');
  });

  it('keeps declared Angular and TypeScript ranges separate from resolved lock versions', () => {
    const result = detect(
      {
        path: 'package.json',
        content: JSON.stringify({
          dependencies: { '@angular/core': '^22.0.0' },
          devDependencies: { typescript: '~6.0.0' },
        }),
      },
      {
        path: 'package-lock.json',
        content: JSON.stringify({
          packages: {
            'node_modules/@angular/core': { version: '22.2.0' },
            'node_modules/typescript': { version: '6.0.2' },
          },
        }),
      },
    );
    assert.deepEqual(
      technology(result, 'angular')
        .versions.map(({ kind }) => kind)
        .sort(),
      ['range', 'resolved'],
    );
    assert.equal(
      technology(result, 'typescript').versions.find(({ kind }) => kind === 'resolved').scope,
      'test',
    );
  });

  it('isolates invalid manifests and reports partial coverage', () => {
    const result = detectTechnologies([
      { path: 'package.json', content: '{broken' },
      { path: '.nvmrc', content: '22' },
    ]);
    assert.equal(result.coverage.status, 'partial');
    assert.equal(result.technologies[0].id, 'nodejs');
  });

  it('does not invent versions from an unresolvable property', () => {
    const result = detectTechnologies([
      {
        path: 'App.csproj',
        content: '<Project><TargetFramework>$(MissingTfm)</TargetFramework></Project>',
      },
    ]);
    assert.equal(result.technologies.length, 0);
    assert.match(result.coverage.issues[0], /unresolved/);
  });
});
