# OWASP ZAP configuration

The dashboard is hosted under the shared `rodri-oliveira-dev.github.io` origin. Without an explicit ZAP context, the baseline spider can follow links from Repo Control Center to the personal site and then crawl unrelated pages and projects on the same host.

`context.context` keeps the scan inside:

```text
https://rodri-oliveira-dev.github.io/repo-status-dashboard/**
```

`rules.tsv` reclassifies findings that are owned by the GitHub Pages/CDN response layer as `INFO`. They remain visible in the full ZAP report but do not create actionable warnings for this application.

Application-controlled findings are intentionally not suppressed. New ZAP alerts that are not listed in `rules.tsv` continue to surface as warnings and are tracked in the repository issue created by the workflow.
