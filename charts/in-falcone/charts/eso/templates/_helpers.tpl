{{- define "eso.normalizeRepository" -}}
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

{{- define "eso.image" -}}
{{- $repo := include "eso.normalizeRepository" (dict "Values" .root.Values "repository" .image.repository) -}}
{{- printf "%s:%s" $repo .image.tag -}}
{{- end -}}
{{- define "eso.imagePullSecrets" -}}
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
