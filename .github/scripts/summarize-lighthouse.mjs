import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const lighthouseConfig = require('../../lighthouserc.cjs');
const assertions = lighthouseConfig?.ci?.assert?.assertions ?? {};
const directory = '.lighthouseci';
const marker = '<!-- lighthouse-ci-report -->';

const categories = [
  { id: 'performance', label: 'Performance', assertion: 'categories:performance' },
  { id: 'accessibility', label: 'Accessibility', assertion: 'categories:accessibility' },
  { id: 'best-practices', label: 'Best Practices', assertion: 'categories:best-practices' },
  { id: 'seo', label: 'SEO', assertion: 'categories:seo' },
];

if (!fs.existsSync(directory)) throw new Error('Lighthouse report directory was not created.');

const reports = fs
  .readdirSync(directory)
  .filter((file) => file.endsWith('.json'))
  .map((file) => {
    try {
      return JSON.parse(fs.readFileSync(path.join(directory, file), 'utf8'));
    } catch {
      return null;
    }
  })
  .filter((report) => report?.categories && report?.finalUrl);

if (reports.length === 0) throw new Error('No Lighthouse reports were found.');

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
};

const percent = (score) => `${Math.round(score * 100)}%`;
const byUrl = new Map();

for (const report of reports) {
  const url = report.finalUrl;
  const entry = byUrl.get(url) ?? {
    performance: [],
    accessibility: [],
    'best-practices': [],
    seo: [],
    seoFailures: new Map(),
  };

  for (const category of categories) entry[category.id].push(report.categories[category.id].score);

  for (const reference of report.categories.seo.auditRefs ?? []) {
    if (!reference.weight) continue;
    const audit = report.audits?.[reference.id];
    if (!audit || audit.score === 1 || audit.scoreDisplayMode === 'notApplicable') continue;

    entry.seoFailures.set(reference.id, {
      title: audit.title,
      displayValue: audit.displayValue,
    });
  }

  byUrl.set(url, entry);
}

const parseAssertion = (key) => {
  const assertion = assertions[key];
  if (!assertion) return { level: 'off', minScore: 0 };
  if (Array.isArray(assertion)) {
    const [level, options = {}] = assertion;
    return { level, minScore: options.minScore ?? 1 };
  }
  return { level: assertion, minScore: 1 };
};

const pageScores = new Map();
for (const [url, entry] of byUrl) {
  pageScores.set(
    url,
    Object.fromEntries(categories.map((category) => [category.id, median(entry[category.id])])),
  );
}

const gateRows = categories.map((category) => {
  const rule = parseAssertion(category.assertion);
  const result = Math.min(...[...pageScores.values()].map((scores) => scores[category.id]));
  const passed = result >= rule.minScore;
  const status = passed ? 'PASS' : rule.level === 'error' ? 'FAIL' : 'WARN';
  const enforcement = rule.level === 'error' ? 'Blocking' : 'Warning';
  return { ...category, ...rule, result, status, enforcement };
});

const lines = [
  marker,
  '## Lighthouse CI',
  '',
  '| Page | Performance | Accessibility | Best Practices | SEO |',
  '| --- | ---: | ---: | ---: | ---: |',
];

for (const [url, scores] of pageScores) {
  const page = new URL(url).pathname || '/';
  lines.push(
    `| \`${page}\` | ${percent(scores.performance)} | ${percent(scores.accessibility)} | ${percent(scores['best-practices'])} | ${percent(scores.seo)} |`,
  );
}

lines.push(
  '',
  '### Quality gates',
  '',
  '| Gate | Threshold | Enforcement | Result | Status |',
  '| --- | ---: | --- | ---: | --- |',
);

for (const row of gateRows) {
  lines.push(
    `| ${row.label} | ≥ ${percent(row.minScore)} | ${row.enforcement} | ${percent(row.result)} | ${row.status} |`,
  );
}

const failures = [...byUrl.entries()].filter(([, entry]) => entry.seoFailures.size > 0);
if (failures.length > 0) {
  lines.push('', '### SEO audits below full score');
  for (const [url, entry] of failures) {
    lines.push('', `**\`${new URL(url).pathname || '/'}\`**`);
    for (const [id, audit] of entry.seoFailures) {
      const detail = audit.displayValue ? ` — ${audit.displayValue}` : '';
      lines.push(`- \`${id}\`: ${audit.title}${detail}`);
    }
  }
}

const comment = `${lines.join('\n')}\n`;
const summary = `${lines.filter((line) => line !== marker).join('\n')}\n`;

console.log(summary);
fs.writeFileSync(path.join(directory, 'pr-comment.md'), comment, 'utf8');

if (process.env.GITHUB_STEP_SUMMARY) {
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary, 'utf8');
}
