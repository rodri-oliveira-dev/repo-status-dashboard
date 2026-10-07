"""ZAP packaged-scan hooks for Repo Control Center.

The baseline spider resets a project-page target to the shared github.io host.
Before the baseline collects alerts and writes its reports, remove alerts that
belong to sibling Pages sites. Also remove only CSP sub-alert 10055-13 for this
static app: it represents directives such as frame-ancestors that cannot be
enforced from a meta CSP. Other 10055 sub-alerts remain actionable.
"""

TARGET_ROOT = "https://rodri-oliveira-dev.github.io/repo-status-dashboard"
HOST_ROOT = "https://rodri-oliveira-dev.github.io/"


def _belongs_to_dashboard(url):
    return url == TARGET_ROOT or url.startswith(TARGET_ROOT + "/")


def zap_get_alerts(zap, baseurl, blacklist, out_of_scope_dict):
    alerts = zap.core.alerts(baseurl=HOST_ROOT, start=0, count=5000)

    for alert in alerts:
        url = alert.get("url", "")
        alert_ref = alert.get("alertRef", "")

        if not _belongs_to_dashboard(url):
            zap.core.delete_alert(alert.get("id"))
            continue

        if alert_ref == "10055-13":
            zap.core.delete_alert(alert.get("id"))

    return zap, baseurl, blacklist, out_of_scope_dict
