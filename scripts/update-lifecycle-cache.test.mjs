import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { updateLifecycleCache } from './update-lifecycle-cache.mjs';

const NOW = Date.parse('2026-01-10T12:00:00Z');
const fresh = '2026-01-10T10:00:00Z';
const old = '2026-01-01T10:00:00Z';

describe('lifecycle cache refresh', () => {
  it('preserves reused product retrieval times and throttles failures independently', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'lifecycle-test-'));
    const filePath = join(directory, 'cache.json');
    const product = (name) => ({
      id: name,
      sourceUrl: 'https://example.test',
      releases: [{ cycle: '1', eol: '2027-01-01' }],
    });
    try {
      await writeFile(
        filePath,
        JSON.stringify({
          schemaVersion: 1,
          updatedAt: fresh,
          products: {
            dotnet: { ...product('dotnet'), retrievedAt: old },
            nodejs: { ...product('nodejs'), retrievedAt: fresh },
            angular: { ...product('angular'), retrievedAt: old },
          },
          attempts: { dotnet: old, nodejs: fresh, angular: old },
        }),
      );
      const called = [];
      const fetcher = async (id) => {
        called.push(id);
        if (id === 'angular') throw new Error('simulated outage');
        return product(id);
      };
      const first = await updateLifecycleCache({ filePath, fetcher, now: () => NOW });
      assert.deepEqual(called, ['dotnet', 'angular']);
      assert.equal(first.products.dotnet.retrievedAt, new Date(NOW).toISOString());
      assert.equal(first.products.nodejs.retrievedAt, fresh);
      assert.equal(first.products.angular.retrievedAt, old);
      assert.deepEqual(first.failedProducts, ['angular']);
      assert.equal(first.attempts.angular, new Date(NOW).toISOString());
      const second = await updateLifecycleCache({ filePath, fetcher, now: () => NOW + 3_600_000 });
      assert.deepEqual(called, ['dotnet', 'angular']);
      assert.equal(second.products.angular.retrievedAt, old);
      assert.deepEqual(JSON.parse(await readFile(filePath, 'utf8')), first);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('migrates legacy global retrieval time before partially refreshing', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'lifecycle-legacy-'));
    const filePath = join(directory, 'cache.json');
    try {
      await writeFile(
        filePath,
        JSON.stringify({
          updatedAt: old,
          products: {
            dotnet: { id: 'dotnet', releases: [] },
            nodejs: { id: 'nodejs', releases: [] },
            angular: { id: 'angular', releases: [] },
          },
        }),
      );
      const result = await updateLifecycleCache({
        filePath,
        now: () => NOW,
        fetcher: async (id) => {
          if (id !== 'nodejs') throw new Error('down');
          return { id, releases: [] };
        },
      });
      assert.equal(result.products.nodejs.retrievedAt, new Date(NOW).toISOString());
      assert.equal(result.products.dotnet.retrievedAt, old);
      assert.equal(result.products.angular.retrievedAt, old);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
