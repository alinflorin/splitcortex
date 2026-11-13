{{- define "splitcortex.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "splitcortex.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{- define "splitcortex.labels" -}}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
app.kubernetes.io/name: {{ include "splitcortex.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/* selector labels: call with (dict "ctx" . "component" "gateway") */}}
{{- define "splitcortex.selectorLabels" -}}
app.kubernetes.io/name: {{ include "splitcortex.name" .ctx }}
app.kubernetes.io/instance: {{ .ctx.Release.Name }}
app.kubernetes.io/component: {{ .component }}
{{- end }}

{{- define "splitcortex.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}{{ include "splitcortex.fullname" . }}{{ else }}default{{ end }}
{{- end }}

{{- define "splitcortex.image" -}}
{{- printf "%s:%s" .image.repository (default .root.Chart.AppVersion .image.tag) }}
{{- end }}

{{- define "splitcortex.dbSecretName" -}}
{{- default (printf "%s-database" (include "splitcortex.fullname" .)) .Values.database.existingSecret }}
{{- end }}

{{- define "splitcortex.sessionSecretName" -}}
{{- default (printf "%s-session" (include "splitcortex.fullname" .)) .Values.controlPlane.sessionSecret.existingSecret }}
{{- end }}

{{- define "splitcortex.serverKeySecretName" -}}
{{- default (printf "%s-server-key" (include "splitcortex.fullname" .)) .Values.gateway.serverKey.existingSecret }}
{{- end }}

{{- define "splitcortex.dbEnv" -}}
- name: DATABASE_URL
  valueFrom:
    secretKeyRef:
      name: {{ include "splitcortex.dbSecretName" . }}
      key: {{ .Values.database.existingSecretKey }}
{{- end }}

{{- define "splitcortex.databaseEnv" -}}
- name: DATABASE_URL
  valueFrom:
    secretKeyRef:
      name: {{ .Values.controlPlane.database.existingSecret }}
      key: {{ .Values.controlPlane.database.key }}
{{- end }}

{{/* Control plane environment: issuer comes from Dex's own config, JWKS defaults to the in-cluster Dex service. */}}
{{- define "splitcortex.controlPlaneEnv" -}}
{{ include "splitcortex.databaseEnv" . }}
- name: LOG_LEVEL
  value: {{ .Values.controlPlane.logLevel | quote }}
- name: OIDC_ISSUER
  value: {{ .Values.dex.config.issuer | quote }}
- name: OIDC_AUDIENCE
  value: {{ .Values.controlPlane.oidc.audience | quote }}
{{- $jwks := .Values.controlPlane.oidc.jwksUrl }}
{{- if and (not $jwks) .Values.dex.enabled }}
{{- $jwks = printf "http://%s-dex:5556/keys" .Release.Name }}
{{- end }}
{{- if $jwks }}
- name: OIDC_JWKS_URL
  value: {{ $jwks | quote }}
{{- end }}
{{- end }}
