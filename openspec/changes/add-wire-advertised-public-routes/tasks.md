## 1. Failing black-box test

- [ ] 1.1 Add a black-box parity test that probes each advertised public route and asserts none returns `NO_ROUTE` (each either responds or is absent from the catalog). Confirm RED.

## 2. Reconcile the surface

- [ ] 2.1 Enumerate advertised-but-unwired routes (storage object I/O, function secrets/triggers/rules, tenant memberships/invitations/custom-roles, tenant dashboard, mongo aggregation/admin, metrics dashboards).
- [ ] 2.2 For each, either wire the intended handler or remove it from the published OpenAPI catalog.

## 3. Verify

- [ ] 3.1 Re-run the parity test — confirm every advertised route either responds or is removed from the catalog.
- [ ] 3.2 Run `bash tests/blackbox/run.sh` to confirm no regressions.
