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
