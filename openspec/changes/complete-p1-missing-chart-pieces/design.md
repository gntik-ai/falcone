## Context

The umbrella chart at `charts/in-falcone/` is well-engineered. The two
sidecar charts (`charts/realtime-gateway/`, `charts/workspace-docs-service/`)
and the `component-wrapper` subchart inside the umbrella are all missing the
basic building blocks that make a Kubernetes workload reachable, gateable,
and bounded. Today an installer of the realtime-gateway chart gets a pod
that nothing can route to, because there is no Service template. An
installer of workspace-docs-service gets a pod that pulls a bare image from
the default registry, runs as root, with no probes and no resource limits.
An installer of the umbrella gets 10 components rendered through a wrapper
that has no probe templates — Kubernetes treats every Running pod as
Healthy regardless of application state.

This is a `complete-*` change because the missing pieces literally do not
exist — there is no buggy template to repair, only absent scaffolding.

## Goals

- Every chart that ships a `kind: Deployment` SHALL also ship a `kind:
  Service` template matching the Deployment's `containerPort`.
- Every chart-managed Deployment SHALL declare `livenessProbe`,
  `readinessProbe`, `resources`, `securityContext`, and a non-default
  `serviceAccountName` populated from values.
- The umbrella's `component-wrapper` SHALL render probe blocks when the
  enabled component supplies the values; the validator MUST warn when a
  known-critical component has no probe paths set.

## Non-goals

- Reconciling the realtime-gateway and workspace-docs-service charts into
  the umbrella's `component-wrapper`; that is the scope of
  `complete-p1-chart-tree-consolidation`.
- Fixing the `:latest` tag or `keycloak.example` host in the realtime-gateway
  values; those are `fix-p1-placeholder-hostnames-and-images`.
- Removing the chart-managed Secret templates that overwrite operator-
  provisioned values; those are `fix-p1-secret-clobbering-and-keys`.

## Decisions

### Decision 1: Service template shape

For `realtime-gateway` and `workspace-docs-service`, the new `service.yaml`
follows the same shape the umbrella's `public-surface.yaml` already uses:
ClusterIP, single port matching the Deployment's `containerPort`, selector
matching the Deployment's `matchLabels`. No NodePort, no LoadBalancer (the
umbrella's public-surface rendering handles external exposure separately).

### Decision 2: Probe shape for component-wrapper

The wrapper takes per-component `probes.{liveness,readiness,startup}` values
keyed by `path`, `port`, `initialDelaySeconds`, `periodSeconds`,
`failureThreshold`, `timeoutSeconds`. When a path is unset for a given probe
the template MUST omit that probe block entirely (rather than render an
empty `livenessProbe: {}` which would default to `exec []` and fail).

The validator surfaces a warning (not a fail) when a known-critical
component (`apisix, keycloak, controlPlane, webConsole`) has no
`probes.liveness.path` — the operator may genuinely have a component with
no HTTP probe (e.g. a sidecar), so this is a soft signal not a hard reject.

### Decision 3: SecurityContext default

The new `securityContext` for workspace-docs-service follows the existing
component-wrapper default: `runAsNonRoot: true`, `runAsUser: 1000`,
`runAsGroup: 1000`, `readOnlyRootFilesystem: true`, `allowPrivilegeEscalation:
false`, `capabilities.drop: ["ALL"]`. Operators can override per-component.

### Decision 4: Image reference shape for workspace-docs-service

The bare `workspace-docs-service:latest` is replaced with
`{{ .Values.image.registry }}/{{ .Values.image.repository }}:{{ .Values.image.tag }}`
with `image.registry` defaulting to the same `global.imageRegistry` the
component-wrapper uses. This puts the chart on the same image-resolution
contract as every other component.

## Migration plan

1. Land the new `service.yaml` and probe templates behind a values flag
   (`probes.enabled: false`) so existing installs are unchanged.
2. Add the per-component probe path values in the umbrella's `values.yaml`
   for the critical components.
3. Flip `probes.enabled: true` by default and add the validator warning.
4. Land the workspace-docs-service hardening in one PR; operators with
   pre-existing pods need to re-roll once.

## Risks / Trade-offs

- Adding a Service in a namespace that already has one of the same name
  causes Helm to fail. Mitigation: name the new Services consistently with
  the chart release name so collisions are detectable at install time.
- Default `runAsNonRoot: true` may break workloads that genuinely need root
  (rare for the components in this chart). Per-component override is
  documented.
