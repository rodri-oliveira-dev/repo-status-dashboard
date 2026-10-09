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

async function previousCache(filePath = OUTPUT) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
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

function recentAttempt(timestamp, now) {
  const parsed = Date.parse(timestamp ?? '');
  const elapsed = now - parsed;
  return Number.isFinite(parsed) && elapsed >= 0 && elapsed < 24 * 60 * 60 * 1000;
}

export async function updateLifecycleCache({
  filePath = OUTPUT,
  fetcher = fetchProduct,
  now = () => Date.now(),
  force = process.argv.includes('--force'),
} = {}) {
  const previous = await previousCache(filePath);
  const nowMs = now();
  const nowIso = new Date(nowMs).toISOString();
  // Legacy v1 caches have only a global timestamp. Migrate product timestamps
  // before any successful individual refresh can advance the global timestamp.
  const products = Object.fromEntries(
    Object.entries(previous?.products ?? {}).map(([id, product]) => [
      id,
      { ...product, retrievedAt: product.retrievedAt ?? previous.updatedAt ?? null },
    ]),
  );
  const attempts = { ...(previous?.attempts ?? {}) };
  const failedProducts = new Set(previous?.failedProducts ?? []);
  let refreshed = 0;
  let attempted = 0;

  for (const id of PRODUCTS) {
    const lastAttempt = attempts[id] ?? products[id]?.retrievedAt;
    if (!force && recentAttempt(lastAttempt, nowMs)) {
      console.log(`[lifecycle] ${id}: refresh skipped (recent attempt)`);
      continue;
    }
    attempted += 1;
    attempts[id] = nowIso;
    try {
      products[id] = { ...(await fetcher(id)), retrievedAt: nowIso };
      refreshed += 1;
      failedProducts.delete(id);
      console.log(`[lifecycle] refreshed ${id}`);
    } catch (error) {
      failedProducts.add(id);
      console.warn(
        `[lifecycle] ${id}: refresh failed; ${products[id] ? 'reusing cache' : 'no cached data available'} (${error instanceof Error ? error.message : String(error)})`,
      );
    }
  }

  if (!attempted && previous) return previous;
  const cache = {
    schemaVersion: 1,
    updatedAt: refreshed ? nowIso : (previous?.updatedAt ?? null),
    source: {
      name: 'endoflife.date',
      url: 'https://endoflife.date/docs/api/v1/',
      schemaVersion: '1.x (beta)',
    },
    products,
    attempts,
    ...(failedProducts.size
      ? {
          failedProducts: [...failedProducts],
          warnings: [...failedProducts].map((id) => `${id}: lifecycle refresh failed`),
        }
      : {}),
  };
  if (!Object.keys(products).length)
    throw new Error('No lifecycle data is available and no cache could be reused.');
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(cache, null, 2)}\n`, 'utf8');
  console.log(`[lifecycle] wrote ${Object.keys(products).length} product(s) to ${filePath}`);
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
