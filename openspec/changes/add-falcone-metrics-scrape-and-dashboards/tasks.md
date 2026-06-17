## 1. Failing black-box test

- [ ] 1.1 Add a black-box/health test asserting Prometheus scrapes at least one Falcone (control-plane/executor) target with non-zero Falcone metrics. Confirm RED.
- [ ] 1.2 Add a test asserting the metrics API returns a non-zero series for a tenant with activity.

## 2. Wire metrics + dashboards

- [ ] 2.1 Expose `/metrics` on the control-plane and executor services and add ServiceMonitors for them.
- [ ] 2.2 Provision Falcone Grafana dashboards, including a per-tenant dashboard.
- [ ] 2.3 Back the metrics API with the real Prometheus series.

## 3. Verify

- [ ] 3.1 Re-run the scrape test — confirm Prometheus scrapes Falcone targets and a tenant dashboard shows non-zero data.
- [ ] 3.2 Run `bash tests/blackbox/run.sh` to confirm no regressions.
