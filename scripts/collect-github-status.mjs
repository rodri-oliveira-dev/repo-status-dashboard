import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  calculateCollection,
  calculateHealth,
  classifyProjectType,
  correlateReleaseVersion,
  extractVersion,
  inferDeliveryType,
  mapDeliveryStatus,
  mapWorkflowStatus,
  selectBuildWorkflow,
  selectDeliveryWorkflow,
  summarizeCollection,
} from './github-status-rules.mjs';

const OWNER = process.env.GITHUB_OWNER || 'rodri-oliveira-dev';
const TOKEN = process.env.GH_DASHBOARD_TOKEN || process.env.GITHUB_TOKEN;
const API = 'https://api.github.com';
const OUTPUT = resolve(dirname(fileURLToPath(import.meta.url)), '../public/data/repositories.json');
const CONCURRENCY = Math.max(1, Math.min(8, Number(process.env.COLLECTOR_CONCURRENCY) || 4));
const warnings = [];
let rateLimitReset = null;

export class GitHubApiError extends Error {
  constructor(status, path, message) {
    super(`GitHub API ${status} for ${path}: ${message}`);
    this.status = status;
  }
}

async function github(path, { absentStatuses = [], attempt = 0 } = {}) {
  if (rateLimitReset && Date.now() < rateLimitReset) {
    throw new GitHubApiError(
      403,
      path,
      `rate limit resets at ${new Date(rateLimitReset).toISOString()}`,
    );
  }
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'repo-control-center-collector',
  };
  if (TOKEN) headers.Authorization = `Bearer ${TOKEN}`;
  let response;
  try {
    response = await fetch(`${API}${path}`, { headers });
  } catch (error) {
    if (attempt === 0) return github(path, { absentStatuses, attempt: 1 });
    throw error;
  }
  if (absentStatuses.includes(response.status)) return null;
  if (!response.ok) {
    const remaining = response.headers.get('x-ratelimit-remaining');
    const reset = response.headers.get('x-ratelimit-reset');
    if (remaining === '0' && reset) rateLimitReset = Number(reset) * 1000;
    const details =
      remaining === '0' && reset
        ? `rate limit resets at ${new Date(Number(reset) * 1000).toISOString()}`
        : response.statusText;
    if (response.status >= 500 && attempt === 0)
      return github(path, { absentStatuses, attempt: 1 });
    throw new GitHubApiError(response.status, path, details);
  }
  return response.json();
}

async function listOwnedRepositories() {
  const repositories = [];
  for (let page = 1; ; page += 1) {
    const batch = await github(
      `/users/${encodeURIComponent(OWNER)}/repos?type=owner&sort=updated&direction=desc&per_page=100&page=${page}`,
    );
    repositories.push(...batch);
    console.log(`[collector] repository page ${page}: ${batch.length} item(s)`);
    if (batch.length < 100) break;
  }
  return repositories.filter(
    (repository) =>
      !repository.fork && repository.owner?.login?.toLowerCase() === OWNER.toLowerCase(),
  );
}

function safeWarning(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/(token|authorization|bearer)(\s*[:=]?\s*)[^\s,;]+/gi, '$1$2[redacted]');
}

async function collectSignal(path, fallback, repositoryName, { absentStatuses = [404] } = {}) {
  try {
    return { data: (await github(path, { absentStatuses })) ?? fallback, available: true };
  } catch (error) {
    const message = safeWarning(error);
    warnings.push(`${repositoryName}: ${message}`);
    console.warn(`[collector] ${repositoryName}: optional data unavailable (${message})`);
    return { data: fallback, available: false, warning: message };
  }
}

function latestDate(...values) {
  return (
    values.filter(Boolean).sort((left, right) => Date.parse(right) - Date.parse(left))[0] ?? null
  );
}

function deliveryFrom({ deployment, deploymentStatus, deliveryWorkflow, release, repository }) {
  if (deployment) {
    const context = [deployment.environment, deployment.description, deployment.ref]
      .filter(Boolean)
      .join(' ');
    return {
      type: inferDeliveryType(context, 'Deployment'),
      status: deploymentStatus ? mapDeliveryStatus(deploymentStatus.state) : 'unknown',
      date: deploymentStatus?.updated_at ?? deployment.updated_at ?? deployment.created_at,
      url:
        deploymentStatus?.environment_url ||
        deploymentStatus?.target_url ||
        `${repository.html_url}/deployments`,
      version:
        extractVersion(deployment.ref, deployment.description) ??
        correlateReleaseVersion(release, deploymentStatus?.updated_at ?? deployment.updated_at),
    };
  }
  if (deliveryWorkflow) {
    const status = mapWorkflowStatus(deliveryWorkflow);
    return {
      type: inferDeliveryType(
        [deliveryWorkflow.name, deliveryWorkflow.path, deliveryWorkflow.display_title].join(' '),
        'Unknown',
      ),
      status: status === 'passing' ? 'success' : status === 'failing' ? 'failure' : status,
      date: deliveryWorkflow.updated_at ?? deliveryWorkflow.created_at,
      url: deliveryWorkflow.html_url,
      version:
        extractVersion(deliveryWorkflow.display_title, deliveryWorkflow.head_branch) ??
        correlateReleaseVersion(
          release,
          deliveryWorkflow.updated_at ?? deliveryWorkflow.created_at,
        ),
    };
  }
  if (release)
    return {
      type: 'GitHub Release',
      status: 'success',
      date: release.published_at ?? release.created_at,
      url: release.html_url,
      version: release.tag_name || null,
    };
  return { type: 'None', status: 'none', date: null, url: null, version: null };
}

async function enrich(repository) {
  const name = repository.name;
  const base = `/repos/${encodeURIComponent(OWNER)}/${encodeURIComponent(name)}`;
  const [commitResult, actionsResult, deploymentResult, releaseResult] = await Promise.all([
    collectSignal(
      `${base}/commits?sha=${encodeURIComponent(repository.default_branch)}&per_page=1`,
      [],
      name,
      { absentStatuses: [404, 409] },
    ),
    collectSignal(`${base}/actions/runs?per_page=50`, { workflow_runs: [] }, name),
    collectSignal(`${base}/deployments?per_page=1`, [], name),
    collectSignal(`${base}/releases/latest`, null, name),
  ]);
  const commits = commitResult.data;
  const workflowResponse = actionsResult.data;
  const deployments = deploymentResult.data;
  const release = releaseResult.data;
  const runs = workflowResponse.workflow_runs ?? [];
  const build = selectBuildWorkflow(runs);
  const deliveryWorkflow = selectDeliveryWorkflow(runs);
  const deployment = deployments[0] ?? null;
  const statusResult = deployment
    ? await collectSignal(`${base}/deployments/${deployment.id}/statuses?per_page=1`, [], name)
    : { data: [], available: true };
  const statuses = statusResult.data;
  const deploymentStatus = statuses[0] ?? null;
  const commit = commits[0]?.commit ?? null;
  const delivery = deliveryFrom({
    deployment,
    deploymentStatus,
    deliveryWorkflow,
    release,
    repository,
  });
  const lastCommitDate =
    commit?.committer?.date ?? commit?.author?.date ?? repository.pushed_at ?? null;
  const buildStatus = mapWorkflowStatus(build);
  const health = calculateHealth({
    archived: repository.archived,
    buildStatus,
    deliveryStatus: delivery.status,
    lastActivityDate: latestDate(lastCommitDate, build?.updated_at, delivery.date),
  });
  const signalResults = {
    metadata: 'available',
    commits: commitResult.available ? 'available' : 'unavailable',
    actions: actionsResult.available ? 'available' : 'unavailable',
    deployments: deploymentResult.available && statusResult.available ? 'available' : 'unavailable',
    releases: releaseResult.available ? 'available' : 'unavailable',
  };
  const repositoryWarnings = [
    commitResult.warning,
    actionsResult.warning,
    deploymentResult.warning,
    statusResult.warning,
    releaseResult.warning,
  ].filter(Boolean);

  return {
    name,
    fullName: repository.full_name,
    url: repository.html_url,
    description: repository.description,
    homepage: repository.homepage || null,
    language: repository.language,
    topics: repository.topics ?? [],
    fork: false,
    archived: repository.archived,
    visibility: repository.visibility,
    defaultBranch: repository.default_branch,
    stars: repository.stargazers_count,
    openIssues: repository.open_issues_count,
    projectType: classifyProjectType(repository),
    lastCommitSha: commits[0]?.sha ?? null,
    lastCommitDate,
    lastWorkflowName: build?.name ?? null,
    lastWorkflowStatus: buildStatus,
    lastWorkflowConclusion: build?.conclusion ?? null,
    lastWorkflowDate: build?.updated_at ?? build?.created_at ?? null,
    lastWorkflowUrl: build?.html_url ?? null,
    deliveryType: delivery.type,
    deliveryStatus: delivery.status,
    deliveryVersion: delivery.version,
    deliveryDate: delivery.date,
    deliveryUrl: delivery.url,
    latestRelease: release?.tag_name ?? null,
    latestReleaseDate: release?.published_at ?? release?.created_at ?? null,
    latestReleaseUrl: release?.html_url ?? null,
    updatedAt: repository.updated_at,
    health,
    collection: calculateCollection(signalResults, repositoryWarnings),
  };
}

async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      try {
        results[index] = await mapper(items[index]);
      } catch (error) {
        const name = items[index]?.name ?? `item ${index}`;
        const message = safeWarning(error);
        warnings.push(`${name}: ${message}`);
        console.error(
          `[collector] ${name}: enrichment failed; preserving repository with unknown signals (${message})`,
        );
        results[index] = fallbackRepository(items[index]);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

function fallbackRepository(repository) {
  return {
    name: repository.name,
    fullName: repository.full_name,
    url: repository.html_url,
    description: repository.description,
    homepage: repository.homepage || null,
    language: repository.language,
    topics: repository.topics ?? [],
    fork: false,
    archived: repository.archived,
    visibility: repository.visibility,
    defaultBranch: repository.default_branch,
    stars: repository.stargazers_count,
    openIssues: repository.open_issues_count,
    projectType: classifyProjectType(repository),
    lastCommitSha: null,
    lastCommitDate: repository.pushed_at ?? null,
    lastWorkflowName: null,
    lastWorkflowStatus: 'unknown',
    lastWorkflowConclusion: null,
    lastWorkflowDate: null,
    lastWorkflowUrl: null,
    deliveryType: 'Unknown',
    deliveryStatus: 'unknown',
    deliveryVersion: null,
    deliveryDate: null,
    deliveryUrl: null,
    latestRelease: null,
    latestReleaseDate: null,
    latestReleaseUrl: null,
    updatedAt: repository.updated_at,
    health: calculateHealth({
      archived: repository.archived,
      buildStatus: 'unknown',
      deliveryStatus: 'unknown',
      lastActivityDate: repository.pushed_at,
    }),
    collection: calculateCollection(
      {
        metadata: 'available',
        commits: 'unavailable',
        actions: 'unavailable',
        deployments: 'unavailable',
        releases: 'unavailable',
      },
      ['Repository enrichment failed; optional signals are unavailable.'],
    ),
  };
}

export async function collect() {
  console.log(
    `[collector] collecting public repository status for ${OWNER}${TOKEN ? ' with authentication' : ' without authentication'}`,
  );
  const repositories = await listOwnedRepositories();
  console.log(
    `[collector] enriching ${repositories.length} non-fork owned repository/repositories with concurrency ${CONCURRENCY}`,
  );
  const enriched = await mapWithConcurrency(repositories, CONCURRENCY, enrich);
  enriched.sort((left, right) =>
    left.name.localeCompare(right.name, 'en', { sensitivity: 'base' }),
  );
  const dataset = {
    schemaVersion: 2,
    owner: OWNER,
    generatedAt: new Date().toISOString(),
    repositories: enriched,
    collection: summarizeCollection(enriched),
    ...(warnings.length ? { warnings } : {}),
  };
  await mkdir(dirname(OUTPUT), { recursive: true });
  await writeFile(OUTPUT, `${JSON.stringify(dataset, null, 2)}\n`, 'utf8');
  console.log(
    `[collector] wrote ${enriched.length} repositories to ${OUTPUT} (${warnings.length} warning(s))`,
  );
  return dataset;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  collect().catch((error) => {
    console.error(`[collector] fatal: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
