import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  adaptEndOfLifeDateProduct,
  buildTechnologyRadarSnapshot,
  evaluateLifecycle,
  migrationUrgency,
} from './technology-lifecycle.mjs';

const asOf = Date.parse('2026-01-01T00:00:00Z');
const technology = { lifecycleProduct: 'example' };
const version = { cycle: '1', kind: 'resolved' };
const cache = (release, updatedAt = '2026-01-01T00:00:00Z') => ({
  updatedAt,
  products: {
    example: { sourceUrl: 'https://example.test', lastModified: updatedAt, releases: [release] },
  },
});

describe('lifecycle evaluation', () => {
  it('isolates and validates the beta API contract', () => {
    const product = adaptEndOfLifeDateProduct({
      schema_version: '1.2.1',
      last_modified: '2025-12-01',
      result: {
        name: 'example',
        links: { html: 'https://example.test' },
        releases: [
          {
            name: '1',
            isLts: true,
            eoasFrom: '2026-06-01',
            eolFrom: '2027-01-01',
            latest: { name: '1.2.3' },
          },
        ],
      },
    });
    assert.equal(product.releases[0].lts, true);
    assert.throws(
      () => adaptEndOfLifeDateProduct({ schema_version: '2.0', result: {} }),
      /Unsupported/,
    );
  });

  it('distinguishes active, maintenance, LTS and EOL', () => {
    const active = evaluateLifecycle(
      technology,
      version,
      cache({ cycle: '1', lts: true, activeSupportEnd: '2026-06-01', eol: '2027-01-01' }),
      { asOf },
    );
    const maintenance = evaluateLifecycle(
      technology,
      version,
      cache({ cycle: '1', lts: false, activeSupportEnd: '2025-06-01', eol: '2027-01-01' }),
      { asOf },
    );
    const eol = evaluateLifecycle(
      technology,
      version,
      cache({ cycle: '1', lts: false, activeSupportEnd: '2024-01-01', eol: '2025-01-01' }),
      { asOf },
    );
    assert.equal(active.lifecycle, 'active');
    assert.equal(active.lts, 'yes');
    assert.equal(maintenance.lifecycle, 'maintenance');
    assert.equal(eol.lifecycle, 'end-of-life');
  });

  it('applies inclusive 90 and 180 day urgency boundaries', () => {
    assert.equal(migrationUrgency('2026-04-01', asOf).urgency, 'migration-approaching');
    assert.equal(migrationUrgency('2026-06-30', asOf).urgency, 'monitor');
    assert.equal(migrationUrgency('2026-07-01', asOf).urgency, 'no-immediate-action');
  });

  it('keeps absent dates, ranges, unavailable products and non-LTS policies unknown', () => {
    assert.equal(migrationUrgency(null, asOf).urgency, 'unknown');
    assert.equal(
      evaluateLifecycle(technology, { cycle: '1', kind: 'range' }, cache({ cycle: '1' }), { asOf })
        .lifecycle,
      'unknown',
    );
    assert.equal(evaluateLifecycle(technology, version, null, { asOf }).lifecycle, 'unknown');
    assert.equal(
      evaluateLifecycle({ lifecycleProduct: null }, version, cache({ cycle: '1' }), { asOf }).lts,
      'not-applicable',
    );
  });

  it('uses stale cached data without manufacturing a supported result', () => {
    const result = evaluateLifecycle(
      technology,
      version,
      cache({ cycle: '2' }, '2025-01-01T00:00:00Z'),
      { asOf },
    );
    assert.equal(result.lifecycle, 'unknown');
    assert.equal(result.stale, true);
  });

  it('serializes repository technology separately from operational health', () => {
    const snapshot = buildTechnologyRadarSnapshot({
      owner: 'owner',
      generatedAt: '2026-01-01T00:00:00Z',
      cache: null,
      repositories: [
        {
          name: 'app',
          fullName: 'owner/app',
          url: 'https://example.test/app',
          health: 'failed',
          technology: {
            coverage: {
              status: 'complete',
              treeTruncated: false,
              filesInspected: 1,
              issues: [],
            },
            technologies: [
              {
                id: 'typescript',
                name: 'TypeScript',
                category: 'tool',
                lifecycleProduct: null,
                versions: [
                  {
                    value: '6.0.2',
                    cycle: '6',
                    kind: 'resolved',
                    confidence: 'high',
                    scope: 'test',
                    evidence: [],
                  },
                ],
              },
            ],
          },
        },
      ],
    });
    assert.equal(snapshot.schemaVersion, 1);
    assert.equal(
      snapshot.repositories[0].technologies[0].versions[0].lifecycle.lifecycle,
      'unknown',
    );
    assert.equal('health' in snapshot.repositories[0], false);
    assert.doesNotThrow(() => JSON.parse(JSON.stringify(snapshot)));
  });
});
