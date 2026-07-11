{{- define "in-falcone.name" -}}
{{- default .Chart.Name .Values.global.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "in-falcone.fullname" -}}
{{- printf "%s-%s" .Release.Name (include "in-falcone.name" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "in-falcone.labels" -}}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | quote }}
app.kubernetes.io/name: {{ include "in-falcone.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: in-falcone
{{- end -}}

{{- define "in-falcone.componentServiceName" -}}
{{- $binding := .binding -}}
{{- $root := .root -}}
{{- if $binding.serviceName -}}
{{- $binding.serviceName -}}
{{- else -}}
{{- printf "%s-%s" $root.Release.Name ((index $root.Values $binding.component).wrapper.componentId | default $binding.component) | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}

{{- define "in-falcone.componentSelectorLabels" -}}
{{- $component := index .root.Values .component -}}
app.kubernetes.io/name: {{ $component.wrapper.componentId | default .component }}
app.kubernetes.io/instance: {{ .root.Release.Name }}
{{- end -}}

{{- define "in-falcone.componentServiceNameByAlias" -}}
{{- $root := .root -}}
{{- $component := .component -}}
{{- $serviceName := .serviceName | default "" -}}
{{- if $serviceName -}}
{{- $serviceName -}}
{{- else -}}
{{- printf "%s-%s" $root.Release.Name ((index $root.Values $component).wrapper.componentId | default $component) | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}

{{- define "in-falcone.bootstrapServiceAccountName" -}}
{{- if .Values.bootstrap.serviceAccount.create -}}
{{- default (printf "%s-bootstrap" (include "in-falcone.fullname" .)) .Values.bootstrap.serviceAccount.name -}}
{{- else -}}
{{- default "default" .Values.bootstrap.serviceAccount.name -}}
{{- end -}}
{{- end -}}

{{- define "in-falcone.bootstrapPayloadConfigMapName" -}}
{{- printf "%s-bootstrap-payload" (include "in-falcone.fullname" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "in-falcone.bootstrapScriptConfigMapName" -}}
{{- printf "%s-bootstrap-script" (include "in-falcone.fullname" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "in-falcone.bootstrapGovernanceCatalogName" -}}
{{- printf "%s-bootstrap-governance" (include "in-falcone.fullname" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "in-falcone.bootstrapInternalNamespacesName" -}}
{{- printf "%s-bootstrap-namespaces" (include "in-falcone.fullname" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "in-falcone.apisixAdminServiceName" -}}
{{- printf "%s-apisix-admin" (include "in-falcone.fullname" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "in-falcone.bootstrapOneShotHash" -}}
{{- toJson (dict "keycloak" .Values.bootstrap.oneShot.keycloak "governanceCatalog" .Values.bootstrap.oneShot.governanceCatalog "internalNamespaces" .Values.bootstrap.oneShot.internalNamespaces) | sha256sum -}}
{{- end -}}

{{- /* ------------------------------------------------------------------ */ -}}
{{- /* Temporal (flows engine) helpers.                                    */ -}}
{{- /* Temporal is rendered by first-class umbrella templates (not via the */ -}}
{{- /* component-wrapper sub-chart, which renders only one Deployment per   */ -}}
{{- /* alias). Naming mirrors `<release>-temporal-<role>`.                  */ -}}
{{- /* ------------------------------------------------------------------ */ -}}

{{- define "in-falcone.temporal.fullname" -}}
{{- printf "%s-temporal" .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "in-falcone.temporal.roleName" -}}
{{- printf "%s-temporal-%s" .root.Release.Name .role | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "in-falcone.temporal.labels" -}}
helm.sh/chart: {{ printf "%s-%s" .root.Chart.Name .root.Chart.Version | quote }}
app.kubernetes.io/managed-by: {{ .root.Release.Service }}
app.kubernetes.io/instance: {{ .root.Release.Name }}
app.kubernetes.io/part-of: temporal
in-falcone.io/component: temporal
{{- end -}}

{{- define "in-falcone.temporal.roleLabels" -}}
{{- include "in-falcone.temporal.labels" . }}
app.kubernetes.io/name: temporal-{{ .role }}
app.kubernetes.io/component: temporal-{{ .role }}
temporal.io/role: {{ .role }}
{{- end -}}

{{- define "in-falcone.temporal.roleSelectorLabels" -}}
app.kubernetes.io/instance: {{ .root.Release.Name }}
app.kubernetes.io/name: temporal-{{ .role }}
temporal.io/role: {{ .role }}
{{- end -}}

{{- /* Registry rewrite — mirrors component-wrapper.normalizeRepository so
       global.imageRegistry (Harbor) + airgap installs work for Temporal too, WITHOUT
       depending on the component-wrapper sub-chart's _helpers.tpl being loaded (those
       defines are absent when every wrapper alias is disabled — e.g. a temporal-only
       install). Keep behaviour identical to the wrapper helper. */ -}}
{{- define "in-falcone.temporal.normalizeRepository" -}}
{{- $repository := .repository -}}
{{- $globalRegistry := trimSuffix "/" (default "" .Values.global.imageRegistry) -}}
{{- if or (eq $globalRegistry "") (eq $repository $globalRegistry) (hasPrefix (printf "%s/" $globalRegistry) $repository) -}}
{{- $repository -}}
{{- else -}}
{{- $segments := splitList "/" $repository -}}
{{- $first := first $segments -}}
{{- $hasRegistry := or (contains "." $first) (contains ":" $first) (eq $first "localhost") -}}
{{- if and $hasRegistry (gt (len $segments) 1) -}}
{{- printf "%s/%s" $globalRegistry (join "/" (rest $segments)) -}}
{{- else -}}
{{- printf "%s/%s" $globalRegistry $repository -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{- /* Render an image reference through the registry-rewrite helper so
       global.imageRegistry (Harbor) + airgap installs work for Temporal too. */ -}}
{{- define "in-falcone.temporal.image" -}}
{{- $repo := include "in-falcone.temporal.normalizeRepository" (dict "Values" .root.Values "repository" .image.repository) -}}
{{- printf "%s:%s" $repo .image.tag -}}
{{- end -}}

{{- /* imagePullSecrets normalized exactly like the workload/bootstrap templates. */ -}}
{{- define "in-falcone.temporal.imagePullSecrets" -}}
{{- $secrets := list -}}
{{- range (default (list) .Values.global.imagePullSecrets) -}}
  {{- $secrets = append $secrets (.name | default .) -}}
{{- end -}}
{{- range (default (list) .Values.global.privateRegistry.pullSecretNames) -}}
  {{- $secrets = append $secrets . -}}
{{- end -}}
{{- $secrets = $secrets | uniq -}}
{{- if gt (len $secrets) 0 }}
imagePullSecrets:
{{- range $secrets }}
  - name: {{ . }}
{{- end }}
{{- end -}}
{{- end -}}

{{- /* Shared persistence / visibility env for every Temporal server role + the
       schema Job. SQL visibility on PostgreSQL — NO Elasticsearch (ENABLE_ES=false). */ -}}
{{- define "in-falcone.temporal.persistenceEnv" -}}
{{- $p := .Values.temporal.persistence -}}
- name: DB
  value: {{ $p.driver | quote }}
- name: DB_PORT
  value: {{ $p.port | quote }}
- name: POSTGRES_SEEDS
  value: {{ tpl $p.host . | quote }}
- name: POSTGRES_USER
  value: {{ $p.user | quote }}
- name: POSTGRES_PWD
  {{- if $p.existingSecret }}
  valueFrom:
    secretKeyRef:
      name: {{ $p.existingSecret | quote }}
      key: {{ $p.passwordSecretKey | quote }}
  {{- else }}
  value: {{ $p.password | quote }}
  {{- end }}
- name: DBNAME
  value: {{ $p.database | quote }}
- name: VISIBILITY_DBNAME
  value: {{ $p.visibilityDatabase | quote }}
- name: ENABLE_ES
  value: "false"
- name: SQL_TLS_ENABLED
  value: {{ $p.tls.enabled | quote }}
{{- end -}}
