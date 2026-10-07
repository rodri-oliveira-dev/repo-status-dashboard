# OWASP ZAP configuration

The dashboard is hosted under the shared `rodri-oliveira-dev.github.io` origin.

The packaged ZAP baseline script normalizes a target with a path back to the host root before starting the traditional spider. Because of that behavior, a ZAP context that includes only `/repo-status-dashboard/**` cannot be used as the spider context: the normalized host-root seed would be outside that context and the scan would fail with `URL_NOT_IN_CONTEXT`.

Instead, `rules.tsv` uses a global `OUTOFSCOPE` expression to discard alerts whose URL is not under:

```text
https://rodri-oliveira-dev.github.io/repo-status-dashboard/**
```

This keeps the baseline spider compatible with the packaged action while ensuring that findings from the personal site and sibling GitHub Pages applications are excluded from this repository's actionable report.

The same rules file reclassifies findings owned by the GitHub Pages/CDN response layer as `INFO`. They remain available in the complete ZAP artifact but do not create application-level warnings.

CSP is application-controlled: Angular `security.autoCsp` generates a meta CSP during the production build. ZAP rules `10038` and `10055` are therefore intentionally not reclassified so missing, malformed or weakened CSP policies continue to surface as actionable findings.

Application-controlled findings are intentionally not suppressed. New ZAP alerts that are not explicitly scoped out or reclassified continue to surface as warnings and are tracked in the repository issue created by the workflow.
