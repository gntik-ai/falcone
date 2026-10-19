## Source implementation

- [x] Project Function secrets by reference with ownership guards, pruning and rollback cleanup.
- [x] Persist names/mappings in additive action/version migrations and count real consumers.
- [x] Propagate replacement/revocation and retain product API cleanup obligations.
- [x] Reproduce failed existing-Function redeploy/Secret restore at the fnDeploy request seam.
- [x] Preserve existing registry/version/lifecycle state and allow deployment retry after failure.
- [x] Add read-only namespace discovery and explicit scoped remediation.
- [x] Align OpenAPI declaration aliases and 204 impact headers with runtime behavior.
- [x] Document fail-closed revocation, explicit GC retries, rollback and running-pod limitations.

## Verification and delivery

- [x] Watch existing-Function failure, discovery and declaration contract regressions fail before fixes.
- [x] Complete scoped source tests, public API generation/validation and Markdown checks.
- [ ] Rerun HTTP-backed vault-workspace-secrets tests in PR CI: sandbox listener setup fails with
  `listen EPERM: operation not permitted 127.0.0.1`, cancelling the suite before assertions.
- [ ] Revalidate paired chart RBAC and reuse-values upgrade in PR CI.
- [ ] Run live marker checks across all five kinds, rotation/delete/purge and OpenShift admission
  in the deployment gate. Source maker does not deploy or remediate the cluster.
