import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { adaptEndOfLifeDateProduct } from './technology-lifecycle.mjs';

const OUTPUT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../public/data/lifecycle-cache.json',
);
const PRODUCTS = ['dotnet', 'nodejs', 'angular'];
const API = 'https://endoflife.date/api/v1/products';

async function previousCache() {
  try {
    return JSON.parse(await readFile(OUTPUT, 'utf8'));
  } catch {
    return null;
  }
}

async function fetchProduct(id, attempt = 0) {
  try {
    const response = await fetch(`${API}/${id}/`, {
      signal: globalThis.AbortSignal.timeout(10_000),
      headers: { 'User-Agent': 'repo-control-center-lifecycle-cache' },
    });
    if (!response.ok) {
      if (response.status >= 500 && attempt === 0) return fetchProduct(id, 1);
      throw new Error(`HTTP ${response.status}`);
    }
    return adaptEndOfLifeDateProduct(await response.json());
  } catch (error) {
    if (attempt === 0 && !(error instanceof SyntaxError)) return fetchProduct(id, 1);
    throw error;
  }
}

export async function updateLifecycleCache() {
  const previous = await previousCache();
  const force = process.argv.includes('--force');
  const age = previous?.updatedAt
    ? Date.now() - Date.parse(previous.updatedAt)
    : Number.POSITIVE_INFINITY;
  if (!force && age >= 0 && age < 24 * 60 * 60 * 1000) {
    console.log(`[lifecycle] cache is fresh (${previous.updatedAt}); refresh skipped`);
    return previous;
  }
  const products = { ...(previous?.products ?? {}) };
  const failures = [];
  for (const id of PRODUCTS) {
    try {
      products[id] = await fetchProduct(id);
      console.log(`[lifecycle] refreshed ${id}`);
    } catch (error) {
      failures.push(id);
      console.warn(
        `[lifecycle] ${id}: refresh failed; ${products[id] ? 'reusing cache' : 'no cached data available'} (${error instanceof Error ? error.message : String(error)})`,
      );
    }
  }
  const successful = PRODUCTS.filter((id) => !failures.includes(id));
  const cache = {
    schemaVersion: 1,
    updatedAt: successful.length ? new Date().toISOString() : (previous?.updatedAt ?? null),
    source: {
      name: 'endoflife.date',
      url: 'https://endoflife.date/docs/api/v1/',
      schemaVersion: '1.x (beta)',
    },
    products,
    ...(failures.length
      ? { warnings: failures.map((id) => `${id}: lifecycle refresh failed`) }
      : {}),
  };
  if (!Object.keys(products).length)
    throw new Error('No lifecycle data is available and no cache could be reused.');
  await mkdir(dirname(OUTPUT), { recursive: true });
  await writeFile(OUTPUT, `${JSON.stringify(cache, null, 2)}\n`, 'utf8');
  console.log(`[lifecycle] wrote ${Object.keys(products).length} product(s) to ${OUTPUT}`);
  return cache;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  updateLifecycleCache().catch((error) => {
    console.error(
      `[lifecycle] refresh unavailable: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 0;
  });
}
