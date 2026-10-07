import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export const DEFAULT_INDEX_PATH = 'dist/repo-control-center/browser/index.html';

const REQUIRED_DIRECTIVES = [
  "default-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "frame-src 'none'",
  "font-src 'self' data:",
  "media-src 'none'",
  "manifest-src 'self'",
  "worker-src 'self'",
  "form-action 'none'",
];

export function hardenCspHtml(html) {
  const metaPattern = /(<meta\s+http-equiv="Content-Security-Policy"\s+content=")([^"]*)("[^>]*>)/i;
  const match = html.match(metaPattern);

  if (!match) {
    throw new Error('Angular autoCsp meta tag was not found in the built index.html.');
  }

  const currentPolicy = match[2].trim();
  const directiveNames = new Set(
    currentPolicy
      .split(';')
      .map((directive) => directive.trim().split(/\s+/, 1)[0])
      .filter(Boolean),
  );

  const additions = REQUIRED_DIRECTIVES.filter((directive) => {
    const [name] = directive.split(/\s+/, 1);
    return !directiveNames.has(name);
  });

  if (additions.length === 0) {
    return html;
  }

  const normalizedPolicy = currentPolicy.endsWith(';') ? currentPolicy : `${currentPolicy};`;
  const hardenedPolicy = `${normalizedPolicy}${additions
    .map((directive) => `${directive};`)
    .join('')}`;

  return html.replace(metaPattern, `$1${hardenedPolicy}$3`);
}

export async function hardenCspFile(indexPath = DEFAULT_INDEX_PATH) {
  const html = await readFile(indexPath, 'utf8');
  const hardened = hardenCspHtml(html);
  await writeFile(indexPath, hardened, 'utf8');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await hardenCspFile(process.argv[2] ?? DEFAULT_INDEX_PATH);
}
