import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export const TARGET_ROOT = 'https://rodri-oliveira-dev.github.io/repo-status-dashboard';

export const PLATFORM_MANAGED_PLUGIN_IDS = new Set([
  '10015',
  '10020',
  '10021',
  '10035',
  '10049',
  '10050',
  '10063',
  '10098',
  '10109',
  '90004',
]);

export const ACCEPTED_ALERT_REFS = new Set(['10055-13', '10055-6']);

function belongsToDashboard(uri) {
  return uri === TARGET_ROOT || uri.startsWith(`${TARGET_ROOT}/`);
}

export function collectActionableFindings(report) {
  const findings = [];

  for (const site of report.site ?? []) {
    for (const alert of site.alerts ?? []) {
      const pluginId = String(alert.pluginid ?? '');
      const alertRef = String(alert.alertRef ?? pluginId);
      const instances = (alert.instances ?? []).filter((instance) =>
        belongsToDashboard(String(instance.uri ?? '')),
      );

      if (instances.length === 0) {
        continue;
      }

      if (PLATFORM_MANAGED_PLUGIN_IDS.has(pluginId) || ACCEPTED_ALERT_REFS.has(alertRef)) {
        continue;
      }

      findings.push({
        pluginId,
        alertRef,
        name: String(alert.name ?? 'Unnamed ZAP alert'),
        risk: String(alert.riskdesc ?? 'Unknown'),
        instances,
      });
    }
  }

  return findings;
}

function inlineCode(value) {
  return String(value).replaceAll('`', '\\`').replace(/\s+/g, ' ').trim();
}

export function renderActionableReport(findings, runUrl = '') {
  const lines = [
    '# OWASP ZAP Baseline Report',
    '',
    `Target: [${TARGET_ROOT}/](${TARGET_ROOT}/)`,
    '',
    'This issue contains only application-controlled, actionable findings for Repo Control Center.',
    'GitHub Pages managed headers, sibling-site findings, and documented static-hosting exceptions are excluded.',
  ];

  if (runUrl) {
    lines.push('', `Workflow run: ${runUrl}`);
  }

  if (findings.length === 0) {
    lines.push('', 'No actionable findings remain.');
    return `${lines.join('\n')}\n`;
  }

  lines.push('', '## Actionable findings');

  for (const finding of findings) {
    lines.push(
      '',
      `### ${finding.name} (\`${finding.alertRef}\`)`,
      '',
      `- Risk: ${finding.risk}`,
      `- Plugin: \`${finding.pluginId}\``,
      '- Affected URLs:',
    );

    for (const instance of finding.instances) {
      lines.push(`  - \`${inlineCode(instance.uri)}\``);
    }

    const evidence = finding.instances.find((instance) => instance.evidence)?.evidence;
    if (evidence) {
      lines.push(`- Evidence: \`${inlineCode(evidence)}\``);
    }
  }

  return `${lines.join('\n')}\n`;
}

function argumentValue(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

async function main() {
  const reportPath = argumentValue('--report', 'report_json.json');
  const outputPath = argumentValue('--output', 'zap-actionable.md');
  const runUrl = process.env.ZAP_RUN_URL ?? '';

  const report = JSON.parse(await readFile(reportPath, 'utf8'));
  const findings = collectActionableFindings(report);
  await writeFile(outputPath, renderActionableReport(findings, runUrl), 'utf8');

  if (process.env.GITHUB_OUTPUT) {
    await appendFile(
      process.env.GITHUB_OUTPUT,
      `has_findings=${findings.length > 0}\nfinding_count=${findings.length}\n`,
      'utf8',
    );
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
