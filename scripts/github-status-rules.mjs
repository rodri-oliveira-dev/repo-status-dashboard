const SEMVER = /(?:^|[^\d])v?\d+\.\d+(?:\.\d+)?(?:[-+][0-9a-z.-]+)?(?:$|[^\d])/i;

export const COLLECTION_SIGNAL_GROUPS = [
  'metadata',
  'commits',
  'actions',
  'deployments',
  'releases',
  'workItems',
  'security',
  'packages',
];

export function calculateCollection(signalResults, warningMessages = []) {
  const collectedSignals = COLLECTION_SIGNAL_GROUPS.filter(
    (signal) => signalResults[signal] !== 'unavailable',
  );
  const unavailableSignals = COLLECTION_SIGNAL_GROUPS.filter(
    (signal) => signalResults[signal] === 'unavailable',
  );
  const ratio = collectedSignals.length / COLLECTION_SIGNAL_GROUPS.length;

  return {
    status:
      unavailableSignals.length === 0
        ? 'complete'
        : collectedSignals.length === 0
          ? 'unavailable'
          : 'partial',
    confidence: ratio === 1 ? 'high' : ratio >= 0.5 ? 'medium' : 'low',
    collectedSignals,
    unavailableSignals,
    warnings: [...warningMessages],
  };
}

export function normalizeSecurityAlerts(alerts, configuredStatus) {
  if (alerts === null)
    return configuredStatus === 'disabled'
      ? { status: 'disabled', openAlerts: 0, highCritical: 0 }
      : { status: 'not_configured', openAlerts: 0, highCritical: 0 };
  const highCritical = alerts.filter((alert) => {
    const severity = alert?.security_advisory?.severity ?? alert?.rule?.security_severity_level;
    return severity === 'high' || severity === 'critical';
  }).length;
  return {
    status: alerts.length ? 'findings_present' : 'clean',
    openAlerts: alerts.length,
    highCritical,
  };
}

export function summarizeCollection(repositories) {
  const count = (status) =>
    repositories.filter((repository) => repository.collection.status === status).length;
  return {
    total: repositories.length,
    complete: count('complete'),
    partial: count('partial'),
    unavailable: count('unavailable'),
  };
}

export function countOpenWorkItems(items) {
  return items.reduce(
    (counts, item) => {
      if (item?.pull_request) counts.openPullRequests += 1;
      else counts.openIssues += 1;
      return counts;
    },
    { openIssues: 0, openPullRequests: 0 },
  );
}

export const STALE_WORK_ITEM_DAYS = 30;
export const ACTIVITY_WINDOW_DAYS = 30;

export function analyzeOpenWorkItems(
  items,
  now = Date.now(),
  thresholdDays = STALE_WORK_ITEM_DAYS,
) {
  const counts = countOpenWorkItems(items);
  const cutoff = now - thresholdDays * 24 * 60 * 60 * 1000;
  const stale = items
    .filter(
      (item) =>
        item?.state === 'open' &&
        !item.merged_at &&
        Number.isFinite(Date.parse(item.updated_at ?? '')) &&
        Date.parse(item.updated_at) < cutoff,
    )
    .sort((left, right) => Date.parse(left.updated_at) - Date.parse(right.updated_at));
  const compact = (item) => ({
    number: item.number,
    title: item.title,
    url: item.html_url,
    updatedAt: item.updated_at,
  });
  const staleIssues = stale.filter((item) => !item.pull_request);
  const stalePullRequests = stale.filter((item) => item.pull_request);
  return {
    ...counts,
    staleWorkItems: {
      thresholdDays,
      issuesCount: staleIssues.length,
      pullRequestsCount: stalePullRequests.length,
      oldestIssues: staleIssues.slice(0, 3).map(compact),
      oldestPullRequests: stalePullRequests.slice(0, 3).map(compact),
    },
  };
}

function inWindow(value, cutoff) {
  const timestamp = Date.parse(value ?? '');
  return Number.isFinite(timestamp) && timestamp >= cutoff;
}

export async function paginateWindow(fetchPage, cutoff, itemDate) {
  const items = [];
  for (let page = 1; ; page += 1) {
    const batch = await fetchPage(page);
    items.push(...batch);
    if (batch.length < 100) break;
    const oldest = Date.parse(itemDate(batch.at(-1)) ?? '');
    if (Number.isFinite(oldest) && oldest < cutoff) break;
  }
  return items;
}

export function summarizeActivity(
  { commits, workflowRuns, deployments, releases, availability, configuredWorkflows = {} },
  now = Date.now(),
  windowDays = ACTIVITY_WINDOW_DAYS,
) {
  const cutoff = now - windowDays * 24 * 60 * 60 * 1000;
  const recentRuns = workflowRuns.filter((run) =>
    inWindow(run.updated_at ?? run.created_at, cutoff),
  );
  const ciRuns = recentRuns.filter(
    (run) => classifyWorkflowRole(run, configuredWorkflows) === 'ci',
  );
  return {
    windowDays,
    since: new Date(cutoff).toISOString(),
    commits: availability.commits
      ? commits.filter((commit) =>
          inWindow(commit?.commit?.committer?.date ?? commit?.commit?.author?.date, cutoff),
        ).length
      : null,
    workflowRuns: availability.actions ? recentRuns.length : null,
    successfulCiRuns: availability.actions
      ? ciRuns.filter((run) => mapWorkflowStatus(run) === 'passing').length
      : null,
    failedCiRuns: availability.actions
      ? ciRuns.filter((run) => mapWorkflowStatus(run) === 'failing').length
      : null,
    releases: availability.releases
      ? releases.filter(
          (release) =>
            !release.draft && inWindow(release.published_at ?? release.created_at, cutoff),
        ).length
      : null,
    deployments: availability.deployments
      ? deployments.filter((deployment) =>
          inWindow(deployment.updated_at ?? deployment.created_at, cutoff),
        ).length
      : null,
  };
}

export function calculateDeliveryFrequency(
  { workflowRuns, deployments, releases, availability, configuredWorkflows = {} },
  now = Date.now(),
  windowDays = ACTIVITY_WINDOW_DAYS,
  correlationMinutes = 30,
) {
  const cutoff = now - windowDays * 24 * 60 * 60 * 1000;
  const withinWindow = (date) => inWindow(date, cutoff);
  const releaseEvents = releases
    .filter((release) => !release.draft && withinWindow(release.published_at ?? release.created_at))
    .map((release) => ({
      source: 'release',
      id: release.id,
      date: release.published_at ?? release.created_at,
    }));
  const deploymentEvents = deployments
    .filter((deployment) => withinWindow(deployment.updated_at ?? deployment.created_at))
    .map((deployment) => ({
      source: 'deployment',
      id: deployment.id,
      date: deployment.updated_at ?? deployment.created_at,
    }));
  const workflowEvents = workflowRuns
    .filter(
      (run) =>
        !isDependabotRun(run) &&
        ['delivery', 'release', 'pages'].includes(classifyWorkflowRole(run, configuredWorkflows)) &&
        mapWorkflowStatus(run) === 'passing' &&
        withinWindow(run.updated_at ?? run.created_at),
    )
    .map((run) => ({ source: 'workflow', id: run.id, date: run.updated_at ?? run.created_at }));
  const correlationMs = correlationMinutes * 60 * 1000;
  const clusters = deploymentEvents.map((event) => ({
    dates: [event.date],
    sources: new Set([event.source]),
  }));
  for (const event of [...workflowEvents, ...releaseEvents]) {
    const match = clusters
      .filter(
        (cluster) =>
          !cluster.sources.has(event.source) &&
          cluster.dates.some(
            (date) => Math.abs(Date.parse(event.date) - Date.parse(date)) <= correlationMs,
          ),
      )
      .sort((left, right) => {
        const distance = (cluster) =>
          Math.min(
            ...cluster.dates.map((date) => Math.abs(Date.parse(event.date) - Date.parse(date))),
          );
        return distance(left) - distance(right);
      })[0];
    if (match) {
      match.dates.push(event.date);
      match.sources.add(event.source);
    } else {
      clusters.push({ dates: [event.date], sources: new Set([event.source]) });
    }
  }

  return {
    windowDays,
    releases: availability.releases ? releaseEvents.length : null,
    deliveryEvents:
      availability.deployments && availability.actions && availability.releases
        ? clusters.length
        : null,
    evidence: ['github_deployments', 'delivery_workflows', 'github_releases'],
    correlationMinutes,
  };
}

function workflowFileName(run) {
  return (
    String(run?.path ?? '')
      .split('/')
      .pop()
      ?.toLowerCase() ?? ''
  );
}

function isDependabotRun(run) {
  const actor = String(run?.actor?.login ?? '');
  const triggeringActor = String(run?.triggering_actor?.login ?? '');
  const path = String(run?.path ?? '');

  return (
    /^dependabot(?:\[bot\])?$/i.test(actor) ||
    /^dependabot(?:\[bot\])?$/i.test(triggeringActor) ||
    /(^|\/)dynamic\/dependabot(?:\/|$)/i.test(path)
  );
}

export function classifyWorkflowRole(run, configuredWorkflows = {}) {
  const fileName = workflowFileName(run);
  for (const [role, files] of Object.entries(configuredWorkflows)) {
    if (files.some((file) => file.toLowerCase() === fileName)) return role;
  }
  if (isDependabotRun(run)) return 'maintenance';
  const text = [run?.name, run?.path].filter(Boolean).join(' ').toLowerCase();
  if (!text) return 'unknown';
  let role = 'unknown';
  if (/mutation|stryker|pitest/.test(text)) role = 'mutation';
  else if (/security|codeql|dependency review|secret scan|owasp|zap/.test(text)) role = 'security';
  else if (/github[- ]pages|pages build|pages deploy|gh-pages/.test(text)) role = 'pages';
  else if (/release|create tag|changelog/.test(text)) role = 'release';
  else if (/dependabot|renovate/.test(text)) role = 'maintenance';
  else if (
    /deploy|deployment|publish|nuget|(^|\W)npm(\W|$)|package|docker|container|terraform/.test(text)
  )
    role = 'delivery';
  else if (/stale|sync|maintenance|cleanup/.test(text)) role = 'maintenance';
  else if (/sonar|codecov|coverage|lint|quality|validation|static analysis/.test(text))
    role = 'quality';
  else if (
    /(^|[\s._/-])ci([\s._/-]|$)|continuous integration|build and test|build & test|compile and test/.test(
      text,
    )
  )
    role = 'ci';
  return Object.hasOwn(configuredWorkflows, role) ? 'unknown' : role;
}

export function selectBuildWorkflow(runs, configuredWorkflows = {}) {
  return (
    [...runs]
      .filter(
        (run) => !isDependabotRun(run) && classifyWorkflowRole(run, configuredWorkflows) === 'ci',
      )
      .sort(
        (left, right) =>
          Date.parse(right.updated_at ?? right.created_at) -
          Date.parse(left.updated_at ?? left.created_at),
      )[0] ?? null
  );
}

export function selectDeliveryWorkflow(runs, configuredWorkflows = {}) {
  return (
    [...runs]
      .filter(
        (run) =>
          !isDependabotRun(run) &&
          ['delivery', 'release', 'pages'].includes(classifyWorkflowRole(run, configuredWorkflows)),
      )
      .sort(
        (left, right) =>
          Date.parse(right.updated_at ?? right.created_at) -
          Date.parse(left.updated_at ?? left.created_at),
      )[0] ?? null
  );
}

export function mapWorkflowStatus(run) {
  if (!run) return 'unknown';
  if (
    run.status === 'queued' ||
    run.status === 'waiting' ||
    run.status === 'requested' ||
    run.status === 'pending'
  )
    return 'queued';
  if (run.status === 'in_progress') return 'running';
  if (run.conclusion === 'success' || run.conclusion === 'neutral' || run.conclusion === 'skipped')
    return 'passing';
  if (
    run.conclusion === 'failure' ||
    run.conclusion === 'timed_out' ||
    run.conclusion === 'startup_failure' ||
    run.conclusion === 'action_required'
  )
    return 'failing';
  if (run.conclusion === 'cancelled' || run.conclusion === 'stale') return 'cancelled';
  return 'unknown';
}

export function securityWorkflowEvidence(runs, configuredWorkflows = {}) {
  const run = [...runs]
    .filter((candidate) => classifyWorkflowRole(candidate, configuredWorkflows) === 'security')
    .sort(
      (left, right) =>
        Date.parse(right.updated_at ?? right.created_at) -
        Date.parse(left.updated_at ?? left.created_at),
    )[0];
  if (!run) return { status: 'not_configured', name: null, url: null, date: null };
  return {
    status: mapWorkflowStatus(run),
    name: run.name ?? null,
    url: run.html_url ?? null,
    date: run.updated_at ?? run.created_at ?? null,
  };
}

export function mapDeliveryStatus(value) {
  const status = String(value ?? '').toLowerCase();
  if (['success', 'active'].includes(status)) return 'success';
  if (['failure', 'error'].includes(status)) return 'failure';
  if (status === 'inactive') return 'unknown';
  if (['in_progress', 'running'].includes(status)) return 'running';
  if (['queued', 'pending', 'waiting', 'requested'].includes(status)) return 'queued';
  if (['cancelled', 'canceled'].includes(status)) return 'cancelled';
  return status ? 'unknown' : 'none';
}

export function inferDeliveryType(value, fallback = 'Unknown') {
  const text = String(value ?? '').toLowerCase();
  if (/nuget|\.nupkg/.test(text)) return 'NuGet';
  if (/(^|\W)npm(\W|$)|node package/.test(text)) return 'npm';
  if (/github[- ]pages|gh-pages|pages build|pages deploy/.test(text)) return 'GitHub Pages';
  if (/docker|container|ghcr|image publish/.test(text)) return 'Container';
  if (/terraform|infrastructure apply/.test(text)) return 'Terraform';
  if (/release/.test(text)) return 'GitHub Release';
  if (/deploy/.test(text)) return 'Deployment';
  return fallback;
}

export function extractVersion(...values) {
  for (const value of values) {
    const match = String(value ?? '').match(SEMVER);
    if (match) return match[0].trim().replace(/^[^v\d]+|[^\w.+-]+$/g, '');
  }
  return null;
}

export function correlateReleaseVersion(release, deliveryDate, windowMinutes = 30) {
  const releaseDate = release?.published_at ?? release?.created_at;
  if (!release?.tag_name || !releaseDate || !deliveryDate) return null;
  const distance = Math.abs(Date.parse(releaseDate) - Date.parse(deliveryDate));
  return Number.isFinite(distance) && distance <= windowMinutes * 60 * 1000
    ? release.tag_name
    : null;
}

export function classifyProjectType(repository) {
  const name = String(repository.name ?? '').toLowerCase();
  const description = String(repository.description ?? '').toLowerCase();
  const topics = (repository.topics ?? []).map((topic) => String(topic).toLowerCase());
  const text = [repository.name, repository.description, repository.language, ...topics]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  if (
    /analy[sz]er/.test(name) ||
    topics.some((topic) => ['roslyn-analyzer', 'code-analysis'].includes(topic))
  )
    return 'Analyzer';
  if (/angular/.test(text)) return 'Angular';
  if (/template|starter|boilerplate/.test(text)) return 'Template';
  if (/terraform|infrastructure|devops|iac/.test(text)) return 'Infrastructure';
  if (
    /(^|\W)(cli|command-line|console|dotnet-tool)(\W|$)/.test(text) ||
    /\.net tool/.test(description)
  )
    return 'CLI';
  if (
    /library|nuget|package|sdk/.test(text) ||
    topics.some((topic) => ['dapper', 'source-generator'].includes(topic))
  )
    return 'Library';
  if (/documentation|(^|\W)docs?(\W|$)|github\.io/.test(text)) return 'Documentation';
  if (/sample|example|demo|(^|\W)poc(\W|$)/.test(text)) return 'Sample';
  if (/tool|utility/.test(text)) return 'Tool';
  if (repository.language) return 'Application';
  return 'Unknown';
}

export function calculateHealth(
  { archived, buildStatus, deliveryStatus, lastActivityDate },
  now = Date.now(),
) {
  if (archived) return 'archived';
  if (buildStatus === 'failing' || deliveryStatus === 'failure') return 'failed';
  const activityTime = Date.parse(lastActivityDate ?? '');
  if (!Number.isNaN(activityTime) && now - activityTime > 90 * 24 * 60 * 60 * 1000) return 'stale';
  if (buildStatus === 'passing') return 'healthy';
  if (
    ['running', 'queued', 'cancelled'].includes(buildStatus) ||
    ['running', 'queued', 'cancelled'].includes(deliveryStatus)
  )
    return 'warning';
  if (buildStatus === 'unknown' && (deliveryStatus === 'none' || deliveryStatus === 'unknown'))
    return 'unknown';
  return 'warning';
}

export function calculateHealthAssessment(input, now = Date.now()) {
  const health = calculateHealth(input, now);
  const reasons = [];
  const add = (code, severity) => reasons.push({ code, severity });

  if (input.archived) add('REPOSITORY_ARCHIVED', 'info');
  else {
    if (input.buildStatus === 'failing') add('CI_FAILING', 'critical');
    if (input.deliveryStatus === 'failure') add('DELIVERY_FAILING', 'critical');
    const activityTime = Date.parse(input.lastActivityDate ?? '');
    if (!Number.isNaN(activityTime) && now - activityTime > 90 * 24 * 60 * 60 * 1000)
      add('ACTIVITY_STALE', 'warning');
    if (input.buildStatus === 'running') add('CI_RUNNING', 'warning');
    if (input.buildStatus === 'queued') add('CI_QUEUED', 'warning');
    if (input.buildStatus === 'cancelled') add('CI_CANCELLED', 'warning');
    if (input.buildStatus === 'unknown') add('CI_UNKNOWN', 'warning');
    if (['running', 'queued', 'cancelled'].includes(input.deliveryStatus))
      add('DELIVERY_IN_PROGRESS', 'warning');
    if (input.deliveryStatus === 'none') add('NO_DELIVERY_EVIDENCE', 'info');
  }
  if (input.collectionStatus === 'partial') add('COLLECTION_PARTIAL', 'info');
  if (input.collectionStatus === 'unavailable') add('COLLECTION_UNAVAILABLE', 'warning');

  return { health, reasons };
}
