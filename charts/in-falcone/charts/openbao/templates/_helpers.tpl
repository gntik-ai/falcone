{{- define "openbao.namespace" -}}
{{- .Values.openbao.namespace | default "secret-store" -}}
{{- end -}}

{{- define "openbao.serviceHost" -}}
{{- printf "openbao.%s.svc.cluster.local" (include "openbao.namespace" .) -}}
{{- end -}}

{{- define "openbao.internalServiceHost" -}}
{{- printf "openbao-internal.%s.svc.cluster.local" (include "openbao.namespace" .) -}}
{{- end -}}

{{- define "openbao.address" -}}
{{- printf "https://%s:%v" (include "openbao.serviceHost" .) (.Values.openbao.service.port | default 8200) -}}
{{- end -}}

{{- define "openbao.clusterAddress" -}}
{{- printf "https://$(HOSTNAME).%s:%v" (include "openbao.internalServiceHost" .) (.Values.openbao.service.clusterPort | default 8201) -}}
{{- end -}}

{{- define "openbao.normalizeRepository" -}}
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

{{- define "openbao.image" -}}
{{- $repo := include "openbao.normalizeRepository" (dict "Values" .root.Values "repository" .image.repository) -}}
{{- printf "%s:%s" $repo .image.tag -}}
{{- end -}}
