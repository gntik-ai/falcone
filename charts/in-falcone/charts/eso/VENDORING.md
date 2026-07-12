# External Secrets Vendoring

The `external-secrets` dependency is intentionally tracked as an unpacked chart under
`charts/external-secrets/` so Falcone can render and review the operator, webhook,
cert-controller, RBAC, and conversion-webhook CRD templates as part of the umbrella chart.

`Chart.lock` records the upstream chart provenance for `external-secrets` 0.9.0. To verify or
recreate the dependency archive without changing the tracked unpacked chart:

```sh
helm dependency build charts/in-falcone/charts/eso
```

That command may create `charts/external-secrets-0.9.0.tgz`; the archive is intentionally ignored.
Do not replace the tracked unpacked chart with the archive unless the install source-of-truth is
changed deliberately in a future chart-maintenance change.
