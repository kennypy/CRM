{{- define "nexcrm.fullname" -}}
{{- printf "nexcrm-%s" . | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "nexcrm.labels" -}}
app.kubernetes.io/part-of: nexcrm
app.kubernetes.io/managed-by: {{ .root.Release.Service }}
helm.sh/chart: {{ printf "%s-%s" .root.Chart.Name .root.Chart.Version }}
app.kubernetes.io/version: {{ .root.Chart.AppVersion | quote }}
{{ include "nexcrm.selectorLabels" . }}
{{- end -}}

{{- define "nexcrm.selectorLabels" -}}
app.kubernetes.io/name: {{ .name }}
app.kubernetes.io/instance: {{ .root.Release.Name }}
{{- end -}}

{{- define "nexcrm.image" -}}
{{- $tag := default .root.Chart.AppVersion .root.Values.global.imageTag -}}
{{- printf "%s/%s:%s" .root.Values.global.imageRegistry .svc.image $tag -}}
{{- end -}}

{{/* Pod template shared by services and workers. ctx: {root, name, svc} */}}
{{- define "nexcrm.podTemplate" -}}
metadata:
  labels:
    {{- include "nexcrm.labels" . | nindent 4 }}
  annotations:
    checksum/config: {{ include (print .root.Template.BasePath "/configmap.yaml") .root | sha256sum }}
spec:
  {{- with .root.Values.global.imagePullSecrets }}
  imagePullSecrets:
    {{- toYaml . | nindent 4 }}
  {{- end }}
  terminationGracePeriodSeconds: {{ .root.Values.global.terminationGracePeriodSeconds }}
  securityContext:
    {{- toYaml .root.Values.global.podSecurityContext | nindent 4 }}
  topologySpreadConstraints:
    - maxSkew: 1
      topologyKey: {{ .root.Values.global.topologySpread.zoneKey }}
      whenUnsatisfiable: {{ .root.Values.global.topologySpread.zoneWhenUnsatisfiable }}
      labelSelector:
        matchLabels:
          {{- include "nexcrm.selectorLabels" . | nindent 10 }}
    - maxSkew: 1
      topologyKey: kubernetes.io/hostname
      whenUnsatisfiable: {{ .root.Values.global.topologySpread.nodeWhenUnsatisfiable }}
      labelSelector:
        matchLabels:
          {{- include "nexcrm.selectorLabels" . | nindent 10 }}
  containers:
    - name: {{ .name }}
      image: {{ include "nexcrm.image" . }}
      imagePullPolicy: {{ .root.Values.global.imagePullPolicy }}
      {{- with .svc.command }}
      command:
        {{- toYaml . | nindent 8 }}
      {{- end }}
      securityContext:
        {{- toYaml .root.Values.global.containerSecurityContext | nindent 8 }}
      envFrom:
        - configMapRef:
            name: nexcrm-env
        - secretRef:
            name: {{ required "global.existingSecret is required" .root.Values.global.existingSecret }}
      {{- with .svc.env }}
      env:
        {{- range $k, $v := . }}
        - name: {{ $k }}
          value: {{ $v | quote }}
        {{- end }}
      {{- end }}
      {{- if .svc.port }}
      ports:
        - name: http
          containerPort: {{ .svc.port }}
          protocol: TCP
      {{- end }}
      {{- if and .svc.port .svc.probes }}
      {{- if .svc.probes.tcp }}
      startupProbe:
        tcpSocket: { port: http }
        periodSeconds: 5
        failureThreshold: 24
      livenessProbe:
        tcpSocket: { port: http }
        periodSeconds: 10
        failureThreshold: 3
      readinessProbe:
        tcpSocket: { port: http }
        periodSeconds: 5
        failureThreshold: 2
      {{- else }}
      startupProbe:
        httpGet: { path: {{ .svc.probes.live }}, port: http }
        periodSeconds: 5
        failureThreshold: 24
      livenessProbe:
        httpGet: { path: {{ .svc.probes.live }}, port: http }
        periodSeconds: 10
        timeoutSeconds: 3
        failureThreshold: 3
      readinessProbe:
        httpGet: { path: {{ .svc.probes.ready }}, port: http }
        periodSeconds: 5
        timeoutSeconds: 4
        failureThreshold: 2
      {{- end }}
      {{- end }}
      resources:
        {{- toYaml .svc.resources | nindent 8 }}
{{- end -}}
