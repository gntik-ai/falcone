# Fix executor env upgrades past #980

## Why

#980 moved the executor's JWT configuration from literal env values to
ConfigMap references. Applying the new env entries to an existing Deployment
can retain the old `value` alongside `valueFrom`, which Kubernetes rejects.
Staging required an operator-approved replacement. The reported failure on
every upgrade path remains unverified: Helm 3 three-way patches, Argo-style
client-side apply without a last-applied record, and Helm 4 server-side apply
must each be tested from pre-#980 chart revision `433be51`.

## What changes

- Add the deployment-packaging contract for a tested, atomic migration of only
  `{release}-control-plane-executor` in the release namespace.
- In the deployment repository, choose one mechanism using the upgrade-path
  results. Prefer a documented one-time replacement of the target rendered
  Deployment, subject to the live regression evidence. Record successes and
  failures separately; do not assume Helm needs the same recovery as Argo.
- Test default, staging, prod, prod-TLS and kind-TLS using the overlay
  `deploy/kind/values-production.yaml`, including duplicate names, dual-field
  env entries, rollout availability, ConfigMap readiness and repeat execution.
  Resolve the overlay's duplicate `KEYCLOAK_JWKS_URL` in the deployment change
  if it violates the contract; do not waive the check or revert `valueFrom`.
  Compare the executor's effective JWKS endpoint before and after the repair
  for both TLS profiles, including scheme, host, port and path. Preserve the
  previously effective HTTPS endpoint through the executor ConfigMap source,
  without changing the gateway verifier. Silently dropping a colliding TLS
  literal is not a semantics-preserving repair; rejecting a collision must
  also have a documented, tested way to render each supported TLS profile.
- Document the mechanism, preconditions, verification and rollback in the next
  unpublished chart version's release notes and the #980 prod checklist.
- Hermes updates both source workflow `FALCONE_CHARTS_REF` pins to the final
  deployment HEAD after the deployment maker finishes. The source maker leaves
  those managed pins untouched and reruns the existing Mongo route parity gate
  against the assigned deployment checkout to expose pending synchronization.

## Impact and boundaries

Issue: https://github.com/gntik-ai/falcone/issues/1053. Control-plane risk: R1;
retain the rollout review described by the supplied upgrade risk notes.
Source changes are limited to this OpenSpec. Implementation, live upgrade
evidence, release notes and rollout documentation belong to `falcone-charts`.
This source change neither selects a mechanism without evidence nor claims a
live upgrade succeeded.

Preserve deterministic Helm deployment, immutable image digests, External
Secrets/OpenBao sourcing, and all migration, backup, parity and evidence gates.
Do not change executor runtime behavior, effective JWT/audience configuration,
env names, ConfigMap keys, reconciliation code, or prod host values. Moving
the previously effective TLS env value into the executor ConfigMap source is
allowed to preserve behavior; changing the effective endpoint is not. Audience
reconciliation and real operator-supplied prod issuer/JWKS hosts remain #980
release prerequisites. Kind bearer round trips and the integration PR trigger
remain deferred to #1051.

## Rollout and rollback

Operators reconcile tenant-app and service-account audiences before enabling
enforcement, confirm the real prod hosts in the exact ordered values layers,
and ensure the target executor JWT ConfigMap exists before migrating the
Deployment. No intermediate pod may lack the required JWT configuration.
Replacement must account for live replicas and annotations owned by other
actors, preserve the Service and ConfigMap, and be safe to repeat on migrated
staging. Rollback is limited to the executor Deployment rendered from `433be51`
or a retry forward, as documented and tested in the deployment repository.
No shared-cluster operation is performed by this source change.
