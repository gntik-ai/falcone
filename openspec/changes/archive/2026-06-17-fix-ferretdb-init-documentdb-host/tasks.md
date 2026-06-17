# Tasks — fix-ferretdb-init-documentdb-host

## Implementation
- [x] In `charts/in-falcone/values.yaml` (line ~2128), replace the hardcoded
  `PGHOST: in-falcone-documentdb` with `PGHOST: "{{ .Release.Name }}-documentdb"`.
- [x] In the FerretDB deployment/init-container template, render the host from the
  release name. The component-wrapper rendered `initContainers` via plain `toYaml`
  (no interpolation), so enabled `tpl` on that block
  (`charts/in-falcone/charts/component-wrapper/templates/workload.yaml`:
  `tpl (toYaml .) $`) — mirrors how the seaweedfs component already templates its env.
- [x] Audit for any other hardcoded `in-falcone-*` host references in the FerretDB
  subchart/template. Result: the only release-broken reference was the service *host*
  (the Service is `<release>-documentdb` via component-wrapper.fullname). The
  `in-falcone-documentdb` existingSecret and `in-falcone-documentdb-conf` ConfigMap are
  fixed-name resources — created/provisioned and referenced under the same literal name
  regardless of release — so they are release-independent and out of scope here (D6).

## Verification
- [x] `helm template falcone charts/in-falcone` → init container env shows
  `PGHOST: 'falcone-documentdb'`; `helm template in-falcone …` → `in-falcone-documentdb`
  (default unaffected); `my-baas` → `my-baas-documentdb`. Deterministic across 15 renders
  after `helm dependency build` (the gitignored stale `.tgz` had pre-fix `toYaml`; a real
  install rebuilds deps via install.sh `helm dependency build`).
- [x] Live kind cluster (release `falcone`): from the running DocumentDB pod, the init
  container's exact check `pg_isready -h in-falcone-documentdb` → "no response" (rc=2,
  the Init:0/1 deadlock) vs `pg_isready -h falcone-documentdb` → "accepting connections"
  (rc=0). The fixed chart renders the reachable host; ferretdb pods are Running.
- [x] Black-box regression: `tests/blackbox/ferretdb-init-documentdb-host.test.mjs`
  (4 cases, helm-template-driven, self-skips without helm). Full suite: 640/640 pass.

## Archive
- [ ] `/opsx:archive fix-ferretdb-init-documentdb-host`
