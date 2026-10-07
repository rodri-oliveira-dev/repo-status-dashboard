import { Buffer } from 'node:buffer';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  ACTIVITY_WINDOW_DAYS,
  calculateCollection,
  calculateDeliveryFrequency,
  calculateHealthAssessment,
  analyzeOpenWorkItems,
  classifyProjectType,
  classifyWorkflowRole,
  correlateReleaseVersion,
  extractVersion,
  inferDeliveryType,
  mapDeliveryStatus,
  mapWorkflowStatus,
  normalizeSecurityAlerts,
  paginateWindow,
  securityWorkflowEvidence,
  selectBuildWorkflow,
  selectDeliveryWorkflow,
  summarizeCollection,
  summarizeActivity,
} from './github-status-rules.mjs';
import { decodeRepositoryConfig } from './repository-config.mjs';
import {
  deduplicatePackageCandidates,
  parseNpmManifest,
  parseNuGetProject,
} from './package-metrics.mjs';

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

export function nextGithubPath(link) {
  const next = link?.split(',').find((part) => /rel="next"/.test(part));
  const match = next?.match(/<([^>]+)>/);
  if (!match) return null;
  const url = new URL(match[1], API);
  if (url.origin !== API) throw new Error(`Unexpected GitHub pagination origin: ${url.origin}`);
  return `${url.pathname}${url.search}`;
}

async function github(path, { absentStatuses = [], attempt = 0, includeNext = false } = {}) {
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
    if (attempt === 0) return github(path, { absentStatuses, attempt: 1, includeNext });
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
      return github(path, { absentStatuses, attempt: 1, includeNext });
    throw new GitHubApiError(response.status, path, details);
  }
  const data = await response.json();
  return includeNext ? { data, nextPath: nextGithubPath(response.headers.get('link')) } : data;
}

export function shouldIncludeRepository(repository, owner = OWNER) {
  return (
    !repository.fork &&
    !repository.archived &&
    repository.owner?.login?.toLowerCase() === owner.toLowerCase()
  );
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
  return repositories.filter((repository) => shouldIncludeRepository(repository));
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

async function collectWindowSignal({
  path,
  repositoryName,
  cutoff,
  extractItems = (response) => response,
  itemDate,
  absentStatuses = [404],
}) {
  let failure = null;
  const items = await paginateWindow(
    async (page) => {
      const result = await collectSignal(
        `${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`,
        [],
        repositoryName,
        { absentStatuses },
      );
      if (!result.available) {
        failure = result;
        return [];
      }
      const batch = extractItems(result.data);
      return batch;
    },
    cutoff,
    itemDate,
  );
  if (failure) return { data: items, available: false, warning: failure.warning };
  return { data: items, available: true };
}

async function collectOpenWorkItems(base, repository, generatedAt) {
  const total = repository.open_issues_count ?? 0;
  const pages = Math.max(1, Math.ceil(total / 100));
  const items = [];
  for (let page = 1; page <= pages; page += 1) {
    const result = await collectSignal(
      `${base}/issues?state=open&per_page=100&page=${page}`,
      [],
      repository.name,
    );
    if (!result.available)
      return {
        openIssues: null,
        openPullRequests: null,
        staleWorkItems: null,
        available: false,
        warning: result.warning,
      };
    items.push(...result.data);
  }
  return { ...analyzeOpenWorkItems(items, generatedAt), available: true };
}

async function collectSecurityAlerts(path, repositoryName, configuredStatus) {
  try {
    const alerts = [];
    let nextPath = `${path}${path.includes('?') ? '&' : '?'}per_page=100`;
    while (nextPath) {
      const result = await github(nextPath, { absentStatuses: [404], includeNext: true });
      if (result === null)
        return { ...normalizeSecurityAlerts(null, configuredStatus), available: true };
      alerts.push(...result.data);
      nextPath = result.nextPath;
    }
    return {
      ...normalizeSecurityAlerts(alerts, configuredStatus),
      available: true,
    };
  } catch (error) {
    const message = safeWarning(error);
    warnings.push(`${repositoryName}: ${message}`);
    console.warn(`[collector] ${repositoryName}: security data unavailable (${message})`);
    return {
      status: 'unavailable',
      openAlerts: null,
      highCritical: null,
      available: false,
      warning: message,
    };
  }
}

class NonRetryableResponseError extends Error {}

async function collectOpenSsf(repositoryName, attempt = 0) {
  const url = `https://api.securityscorecards.dev/projects/github.com/${encodeURIComponent(OWNER)}/${encodeURIComponent(repositoryName)}`;
  try {
    const response = await fetch(url, { signal: globalThis.AbortSignal.timeout(8000) });
    if (response.status === 404)
      return { status: 'not_configured', score: null, date: null, url: null, available: true };
    if (!response.ok) {
      if (response.status >= 500 && attempt === 0) return collectOpenSsf(repositoryName, 1);
      throw new NonRetryableResponseError(`OpenSSF API ${response.status}: ${response.statusText}`);
    }
    const result = await response.json();
    return {
      status: 'available',
      score: Number.isFinite(result.score) ? result.score : null,
      date: result.date ?? null,
      url: `https://securityscorecards.dev/viewer/?uri=github.com/${encodeURIComponent(OWNER)}/${encodeURIComponent(repositoryName)}`,
      available: true,
    };
  } catch (error) {
    if (
      attempt === 0 &&
      !(error instanceof NonRetryableResponseError) &&
      !(error instanceof SyntaxError)
    )
      return collectOpenSsf(repositoryName, 1);
    const message = safeWarning(error);
    warnings.push(`${repositoryName}: ${message}`);
    console.warn(`[collector] ${repositoryName}: OpenSSF data unavailable (${message})`);
    return {
      status: 'unavailable',
      score: null,
      date: null,
      url: null,
      available: false,
      warning: message,
    };
  }
}

function decodeGitHubContent(content) {
  if (content?.encoding !== 'base64' || typeof content.content !== 'string') return null;
  return Buffer.from(content.content, 'base64').toString('utf8');
}

async function publicJson(url, source, repositoryName, attempt = 0) {
  try {
    const response = await fetch(url, { signal: globalThis.AbortSignal.timeout(8000) });
    if (response.status === 404) return { data: null, available: true };
    if (!response.ok) {
      if (response.status >= 500 && attempt === 0)
        return publicJson(url, source, repositoryName, 1);
      throw new NonRetryableResponseError(
        `${source} API ${response.status}: ${response.statusText}`,
      );
    }
    return { data: await response.json(), available: true };
  } catch (error) {
    if (
      attempt === 0 &&
      !(error instanceof NonRetryableResponseError) &&
      !(error instanceof SyntaxError)
    )
      return publicJson(url, source, repositoryName, 1);
    const message = safeWarning(error);
    warnings.push(`${repositoryName}: ${message}`);
    console.warn(`[collector] ${repositoryName}: ${source} data unavailable (${message})`);
    return { data: null, available: false, warning: message };
  }
}

async function enrichPackageCandidate(candidate, repositoryName) {
  if (candidate.ecosystem === 'npm') {
    const encoded = encodeURIComponent(candidate.id);
    const [registry, downloads] = await Promise.all([
      publicJson(`https://registry.npmjs.org/${encoded}/latest`, 'npm registry', repositoryName),
      publicJson(
        `https://api.npmjs.org/downloads/point/last-month/${encoded}`,
        'npm downloads',
        repositoryName,
      ),
    ]);
    return {
      item: {
        ecosystem: 'npm',
        id: candidate.id,
        status: registry.available ? (registry.data ? 'published' : 'unpublished') : 'unavailable',
        version: registry.data?.version ?? null,
        url: `https://www.npmjs.com/package/${encoded}`,
        downloads:
          downloads.available && downloads.data
            ? {
                count: downloads.data.downloads,
                period: 'last-month',
                start: downloads.data.start,
                end: downloads.data.end,
              }
            : null,
      },
      available: registry.available && downloads.available,
      warnings: [registry.warning, downloads.warning].filter(Boolean),
    };
  }
  const query = await publicJson(
    `https://azuresearch-usnc.nuget.org/query?q=${encodeURIComponent(`packageid:${candidate.id}`)}&prerelease=false&semVerLevel=2.0.0`,
    'NuGet',
    repositoryName,
  );
  const match = query.data?.data?.find(
    (item) => item.id?.toLowerCase() === candidate.id.toLowerCase(),
  );
  return {
    item: {
      ecosystem: 'nuget',
      id: candidate.id,
      status: query.available ? (match ? 'published' : 'unpublished') : 'unavailable',
      version: match?.version ?? null,
      url: `https://www.nuget.org/packages/${encodeURIComponent(candidate.id)}`,
      downloads: match
        ? { count: match.totalDownloads, period: 'lifetime', start: null, end: null }
        : null,
    },
    available: query.available,
    warnings: [query.warning].filter(Boolean),
  };
}

async function collectPackageMetrics(repository, base, deliveryType) {
  const candidates = [];
  const packageWarnings = [];
  let sourceAvailable = true;
  let ambiguous = false;
  const npmCandidate =
    deliveryType === 'npm' || ['JavaScript', 'TypeScript'].includes(repository.language);
  if (npmCandidate) {
    const manifestResult = await collectSignal(
      `${base}/contents/package.json`,
      null,
      repository.name,
    );
    sourceAvailable &&= manifestResult.available;
    if (manifestResult.warning) packageWarnings.push(manifestResult.warning);
    if (manifestResult.data) {
      const source = decodeGitHubContent(manifestResult.data);
      const candidate = source
        ? parseNpmManifest(source, repository.full_name)
        : { status: 'ambiguous', reason: 'package.json content could not be decoded' };
      candidates.push(candidate);
      ambiguous ||= candidate.status === 'ambiguous';
    }
  }

  const nugetCandidate = deliveryType === 'NuGet' || repository.language === 'C#';
  if (nugetCandidate) {
    const treeResult = await collectSignal(
      `${base}/git/trees/${encodeURIComponent(repository.default_branch)}?recursive=1`,
      null,
      repository.name,
    );
    sourceAvailable &&= treeResult.available;
    if (treeResult.warning) packageWarnings.push(treeResult.warning);
    if (treeResult.data?.truncated) {
      ambiguous = true;
      const message = 'repository tree was truncated while discovering NuGet package metadata';
      warnings.push(`${repository.name}: ${message}`);
      packageWarnings.push(message);
    }
    const projects = (treeResult.data?.tree ?? []).filter(
      (entry) => entry.type === 'blob' && entry.path?.toLowerCase().endsWith('.csproj'),
    );
    for (const project of projects) {
      const blobPath = String(project.url).replace(API, '');
      const blobResult = await collectSignal(blobPath, null, repository.name);
      sourceAvailable &&= blobResult.available;
      if (blobResult.warning) packageWarnings.push(blobResult.warning);
      if (!blobResult.data) continue;
      const source = decodeGitHubContent(blobResult.data);
      const candidate = source
        ? parseNuGetProject(source, repository.full_name)
        : { status: 'ambiguous', reason: `${project.path} could not be decoded` };
      candidates.push(candidate);
      ambiguous ||= candidate.status === 'ambiguous';
    }
  }

  const verified = deduplicatePackageCandidates(candidates).filter(
    (candidate) => candidate.status === 'verified',
  );
  if (!sourceAvailable)
    return { status: 'unavailable', items: [], available: false, warnings: packageWarnings };
  if (!verified.length)
    return {
      status: ambiguous ? 'ambiguous' : 'none',
      items: [],
      available: true,
      warnings: packageWarnings,
    };

  const enriched = await Promise.all(
    verified.map((candidate) => enrichPackageCandidate(candidate, repository.name)),
  );
  const complete = enriched.every((result) => result.available);
  return {
    status: complete ? 'available' : 'partial',
    items: enriched.map((result) => result.item),
    available: complete,
    warnings: [...packageWarnings, ...enriched.flatMap((result) => result.warnings)],
  };
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

async function enrich(repository, generatedAt) {
  const name = repository.name;
  const base = `/repos/${encodeURIComponent(OWNER)}/${encodeURIComponent(name)}`;
  const activityCutoff = generatedAt - ACTIVITY_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const configResult = await collectSignal(`${base}/contents/.repo-dashboard.yml`, null, name);
  let configuredWorkflows = {};
  if (configResult.data) {
    try {
      configuredWorkflows = decodeRepositoryConfig(configResult.data).workflows;
    } catch (error) {
      const message = `invalid .repo-dashboard.yml: ${safeWarning(error)}`;
      configResult.warning = message;
      warnings.push(`${name}: ${message}`);
      console.warn(`[collector] ${name}: ${message}`);
    }
  }
  const [
    commitResult,
    actionsResult,
    deploymentResult,
    releaseResult,
    workItemsResult,
    dependabotResult,
    codeScanningResult,
    openSsfResult,
  ] = await Promise.all([
    collectWindowSignal({
      path: `${base}/commits?sha=${encodeURIComponent(repository.default_branch)}`,
      repositoryName: name,
      cutoff: activityCutoff,
      itemDate: (commit) => commit?.commit?.committer?.date ?? commit?.commit?.author?.date,
      absentStatuses: [404, 409],
    }),
    collectWindowSignal({
      path: `${base}/actions/runs`,
      repositoryName: name,
      cutoff: activityCutoff,
      extractItems: (response) => response.workflow_runs ?? [],
      itemDate: (run) => run.updated_at ?? run.created_at,
    }),
    collectWindowSignal({
      path: `${base}/deployments`,
      repositoryName: name,
      cutoff: activityCutoff,
      itemDate: (deployment) => deployment.updated_at ?? deployment.created_at,
    }),
    collectWindowSignal({
      path: `${base}/releases`,
      repositoryName: name,
      cutoff: activityCutoff,
      itemDate: (release) => release.published_at ?? release.created_at,
    }),
    collectOpenWorkItems(base, repository, generatedAt),
    collectSecurityAlerts(
      `${base}/dependabot/alerts?state=open`,
      name,
      repository.security_and_analysis?.dependabot_security_updates?.status,
    ),
    collectSecurityAlerts(
      `${base}/code-scanning/alerts?state=open`,
      name,
      repository.security_and_analysis?.advanced_security?.status,
    ),
    collectOpenSsf(name),
  ]);
  const commits = commitResult.data;
  const deployments = deploymentResult.data;
  const releases = releaseResult.data;
  const release = releases.find((candidate) => !candidate.draft && !candidate.prerelease) ?? null;
  const runs = actionsResult.data;
  const build = selectBuildWorkflow(runs, configuredWorkflows);
  const deliveryWorkflow = selectDeliveryWorkflow(runs, configuredWorkflows);
  const securityWorkflow = actionsResult.available
    ? securityWorkflowEvidence(runs, configuredWorkflows)
    : { status: 'unavailable', name: null, url: null, date: null };
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
  const packages = await collectPackageMetrics(repository, base, delivery.type);
  const lastCommitDate =
    commit?.committer?.date ?? commit?.author?.date ?? repository.pushed_at ?? null;
  const buildStatus = mapWorkflowStatus(build);
  const signalResults = {
    metadata: 'available',
    commits: commitResult.available ? 'available' : 'unavailable',
    actions: actionsResult.available ? 'available' : 'unavailable',
    deployments: deploymentResult.available && statusResult.available ? 'available' : 'unavailable',
    releases: releaseResult.available ? 'available' : 'unavailable',
    workItems: workItemsResult.available ? 'available' : 'unavailable',
    security:
      dependabotResult.available &&
      codeScanningResult.available &&
      openSsfResult.available &&
      actionsResult.available
        ? 'available'
        : 'unavailable',
    packages: packages.available ? 'available' : 'unavailable',
  };
  const repositoryWarnings = [
    commitResult.warning,
    actionsResult.warning,
    deploymentResult.warning,
    statusResult.warning,
    releaseResult.warning,
    configResult.warning,
    workItemsResult.warning,
    dependabotResult.warning,
    codeScanningResult.warning,
    openSsfResult.warning,
    ...packages.warnings,
  ].filter(Boolean);
  const collection = calculateCollection(signalResults, repositoryWarnings);
  const assessment = calculateHealthAssessment({
    archived: repository.archived,
    buildStatus,
    deliveryStatus: delivery.status,
    lastActivityDate: latestDate(lastCommitDate, build?.updated_at, delivery.date),
    collectionStatus: collection.status,
  });
  const activity = summarizeActivity(
    {
      commits,
      workflowRuns: runs,
      deployments,
      releases,
      configuredWorkflows,
      availability: {
        commits: commitResult.available,
        actions: actionsResult.available,
        deployments: deploymentResult.available,
        releases: releaseResult.available,
      },
    },
    generatedAt,
  );
  const deliveryFrequency = calculateDeliveryFrequency(
    {
      workflowRuns: runs,
      deployments,
      releases,
      configuredWorkflows,
      availability: {
        actions: actionsResult.available,
        deployments: deploymentResult.available,
        releases: releaseResult.available,
      },
    },
    generatedAt,
  );

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
    openIssues: workItemsResult.openIssues,
    openPullRequests: workItemsResult.openPullRequests,
    staleWorkItems: workItemsResult.staleWorkItems,
    security: {
      dependabot: {
        status: dependabotResult.status,
        openAlerts: dependabotResult.openAlerts,
        highCritical: dependabotResult.highCritical,
      },
      codeScanning: {
        status: codeScanningResult.status,
        openAlerts: codeScanningResult.openAlerts,
        highCritical: codeScanningResult.highCritical,
      },
      workflow: securityWorkflow,
      openSsf: {
        status: openSsfResult.status,
        score: openSsfResult.score,
        date: openSsfResult.date,
        url: openSsfResult.url,
      },
    },
    activity,
    deliveryFrequency,
    packages: {
      status: packages.status,
      items: packages.items,
    },
    projectType: classifyProjectType(repository),
    lastCommitSha: commits[0]?.sha ?? null,
    lastCommitDate,
    lastWorkflowName: build?.name ?? null,
    lastWorkflowRole: build ? classifyWorkflowRole(build, configuredWorkflows) : 'unknown',
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
    health: assessment.health,
    healthReasons: assessment.reasons,
    collection,
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

function fallbackRepository(repository, generatedAt = Date.now()) {
  const collection = calculateCollection(
    {
      metadata: 'available',
      commits: 'unavailable',
      actions: 'unavailable',
      deployments: 'unavailable',
      releases: 'unavailable',
      workItems: 'unavailable',
      security: 'unavailable',
      packages: 'unavailable',
    },
    ['Repository enrichment failed; optional signals are unavailable.'],
  );
  const assessment = calculateHealthAssessment({
    archived: repository.archived,
    buildStatus: 'unknown',
    deliveryStatus: 'unknown',
    lastActivityDate: repository.pushed_at,
    collectionStatus: collection.status,
  });
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
    openIssues: null,
    openPullRequests: null,
    staleWorkItems: null,
    security: {
      dependabot: { status: 'unavailable', openAlerts: null, highCritical: null },
      codeScanning: { status: 'unavailable', openAlerts: null, highCritical: null },
      workflow: { status: 'unavailable', name: null, url: null, date: null },
      openSsf: { status: 'unavailable', score: null, date: null, url: null },
    },
    activity: {
      windowDays: ACTIVITY_WINDOW_DAYS,
      since: new Date(generatedAt - ACTIVITY_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString(),
      commits: null,
      workflowRuns: null,
      successfulCiRuns: null,
      failedCiRuns: null,
      releases: null,
      deployments: null,
    },
    deliveryFrequency: {
      windowDays: ACTIVITY_WINDOW_DAYS,
      releases: null,
      deliveryEvents: null,
      evidence: ['github_deployments', 'delivery_workflows', 'github_releases'],
      correlationMinutes: 30,
    },
    packages: { status: 'unavailable', items: [] },
    projectType: classifyProjectType(repository),
    lastCommitSha: null,
    lastCommitDate: repository.pushed_at ?? null,
    lastWorkflowName: null,
    lastWorkflowRole: 'unknown',
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
    health: assessment.health,
    healthReasons: assessment.reasons,
    collection,
  };
}

export async function collect() {
  const generatedAt = Date.now();
  console.log(
    `[collector] collecting public repository status for ${OWNER}${TOKEN ? ' with authentication' : ' without authentication'}`,
  );
  const repositories = await listOwnedRepositories();
  console.log(
    `[collector] enriching ${repositories.length} active non-fork owned repository/repositories with concurrency ${CONCURRENCY}`,
  );
  const enriched = await mapWithConcurrency(repositories, CONCURRENCY, (repository) =>
    enrich(repository, generatedAt),
  );
  enriched.sort((left, right) =>
    left.name.localeCompare(right.name, 'en', { sensitivity: 'base' }),
  );
  const dataset = {
    schemaVersion: 2,
    owner: OWNER,
    generatedAt: new Date(generatedAt).toISOString(),
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
