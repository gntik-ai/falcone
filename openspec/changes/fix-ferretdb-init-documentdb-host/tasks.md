# Tasks — fix-ferretdb-init-documentdb-host

## Implementation
- [ ] In `charts/in-falcone/values.yaml` (around line 2129), replace the hardcoded
  `PGHOST: in-falcone-documentdb` with a template reference.
- [ ] In the FerretDB deployment/init-container template, render the host as
  `{{ .Release.Name }}-documentdb` (or the equivalent component-service name helper).
- [ ] Audit for any other hardcoded `in-falcone-*` host references in the FerretDB
  subchart/template and apply the same fix.

## Verification
- [ ] `helm template --release-name falcone .` → init container env shows
  `PGHOST=falcone-documentdb`.
- [ ] Deploy with release name `falcone` on kind → FerretDB pod reaches `Running`.
- [ ] Run `/opsx:verify fix-ferretdb-init-documentdb-host`.

## Archive
- [ ] `/opsx:archive fix-ferretdb-init-documentdb-host`
