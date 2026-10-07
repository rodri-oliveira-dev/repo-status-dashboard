const BUILD_TERMS = /(^|[\s._/-])(ci|build|test|tests|quality|validation)([\s._/-]|$)/i;
const DELIVERY_TERMS =
  /(^|[\s._/-])(deploy|deployment|publish|release|pages|nuget|npm|package|docker|container|terraform)([\s._/-]|$)/i;
const DEPENDABOT = /dependabot/i;
const SEMVER = /(?:^|[^\d])v?\d+\.\d+(?:\.\d+)?(?:[-+][0-9a-z.-]+)?(?:$|[^\d])/i;

export const COLLECTION_SIGNAL_GROUPS = [
  'metadata',
  'commits',
  'actions',
  'deployments',
  'releases',
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
    confidence: ratio === 1 ? 'high' : ratio >= 0.6 ? 'medium' : 'low',
    collectedSignals,
    unavailableSignals,
    warnings: [...warningMessages],
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

function workflowText(run) {
  return [run?.name, run?.display_title, run?.path, run?.actor?.login, run?.triggering_actor?.login]
    .filter(Boolean)
    .join(' ');
}

export function selectBuildWorkflow(runs) {
  return (
    [...runs]
      .filter((run) => !DEPENDABOT.test(workflowText(run)) && BUILD_TERMS.test(workflowText(run)))
      .sort(
        (left, right) =>
          Date.parse(right.updated_at ?? right.created_at) -
          Date.parse(left.updated_at ?? left.created_at),
      )[0] ?? null
  );
}

export function selectDeliveryWorkflow(runs) {
  return (
    [...runs]
      .filter((run) => DELIVERY_TERMS.test(workflowText(run)))
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
