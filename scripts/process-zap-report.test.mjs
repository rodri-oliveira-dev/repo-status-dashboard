import assert from 'node:assert/strict';
import { test } from 'node:test';

import { collectActionableFindings, renderActionableReport } from './process-zap-report.mjs';

function alert(pluginid, alertRef, name, uri, evidence = '') {
  return {
    pluginid,
    alertRef,
    name,
    riskdesc: 'Medium (High)',
    instances: [{ uri, evidence }],
  };
}

test('collectActionableFindings keeps only dashboard application findings', () => {
  const report = {
    site: [
      {
        alerts: [
          alert(
            '10055',
            '10055-4',
            'CSP: Wildcard Directive',
            'https://rodri-oliveira-dev.github.io/repo-status-dashboard/',
          ),
          alert(
            '10055',
            '10055-13',
            'Expected meta CSP limitation',
            'https://rodri-oliveira-dev.github.io/repo-status-dashboard/',
          ),
          alert(
            '10055',
            '10055-6',
            'Expected Angular inline styles',
            'https://rodri-oliveira-dev.github.io/repo-status-dashboard/',
          ),
          alert(
            '10020',
            '10020-1',
            'Pages header',
            'https://rodri-oliveira-dev.github.io/repo-status-dashboard/',
          ),
          alert('10055', '10055-4', 'Sibling finding', 'https://rodri-oliveira-dev.github.io/'),
        ],
      },
    ],
  };

  const findings = collectActionableFindings(report);

  assert.equal(findings.length, 1);
  assert.equal(findings[0].alertRef, '10055-4');
});

test('10055 variants not explicitly accepted stay actionable', () => {
  const report = {
    site: [
      {
        alerts: [
          alert(
            '10055',
            '10055-5',
            'CSP: script-src unsafe-inline',
            'https://rodri-oliveira-dev.github.io/repo-status-dashboard/',
          ),
          alert(
            '10055',
            '10055-7',
            'CSP: unsafe-eval',
            'https://rodri-oliveira-dev.github.io/repo-status-dashboard/',
          ),
        ],
      },
    ],
  };

  const findings = collectActionableFindings(report);

  assert.deepEqual(
    findings.map((finding) => finding.alertRef),
    ['10055-5', '10055-7'],
  );
});

test('renderActionableReport never includes filtered sibling URLs', () => {
  const findings = collectActionableFindings({
    site: [
      {
        alerts: [
          alert(
            '10055',
            '10055-4',
            'CSP: Wildcard Directive',
            'https://rodri-oliveira-dev.github.io/repo-status-dashboard/',
            'connect-src *',
          ),
        ],
      },
    ],
  });

  const markdown = renderActionableReport(findings, 'https://github.com/example/actions/runs/1');

  assert.match(markdown, /CSP: Wildcard Directive/);
  assert.match(markdown, /repo-status-dashboard/);
  assert.doesNotMatch(markdown, /dotnet-observability-lab/);
});
