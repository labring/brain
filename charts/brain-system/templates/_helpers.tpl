{{- define "brain-system.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "brain-system.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s" (include "brain-system.name" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}

{{- define "brain-system.labels" -}}
app.kubernetes.io/name: {{ include "brain-system.name" . }}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version | replace "+" "_" }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- with .Values.global.labels }}
{{ toYaml . }}
{{- end }}
{{- end -}}

{{- define "brain-system.labelsWithoutInstance" -}}
app.kubernetes.io/name: {{ include "brain-system.name" . }}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version | replace "+" "_" }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- with .Values.global.labels }}
{{ toYaml . }}
{{- end }}
{{- end -}}

{{- define "brain-system.annotations" -}}
{{- with .Values.global.annotations }}
{{ toYaml . }}
{{- end }}
{{- end -}}

{{- define "brain-system.regionLabel" -}}
region: {{ required "global.region is required" .Values.global.region | quote }}
{{- end -}}

{{- define "brain-system.envValue" -}}
- name: {{ .name }}
  value: {{ .value | quote }}
{{- end -}}

{{- define "brain-system.projectId" -}}
{{- default .Release.Namespace .Values.projectId -}}
{{- end -}}

{{- define "brain-system.brainLabels" -}}
brain.io/managed-by: brain
brain.io/project-id: {{ .projectId | quote }}
brain.io/resource-kind: {{ .kind | quote }}
brain.io/resource-name: {{ .name | quote }}
{{- end -}}

{{- define "brain-system.apManagerLabels" -}}
{{- include "brain-system.brainLabels" (dict "projectId" .projectId "kind" "ap" "name" .name) }}
brain.io/app-name: {{ .name | quote }}
cloud.sealos.io/app-deploy-manager: {{ .name | quote }}
{{- with .region }}
region: {{ . | quote }}
{{- end }}
{{- end -}}

{{- define "brain-system.apPodLabels" -}}
{{- include "brain-system.apManagerLabels" . }}
app: {{ .name | quote }}
{{- end -}}

{{- define "brain-system.dbLabels" -}}
{{- include "brain-system.brainLabels" (dict "projectId" .projectId "kind" "db" "name" .name) }}
brain.io/db-engine: {{ .engine | quote }}
brain.io/db-name: {{ .name | quote }}
clusterdefinition.kubeblocks.io/name: {{ .clusterDefinition | quote }}
clusterversion.kubeblocks.io/name: {{ .clusterVersion | quote }}
sealos-db-provider-cr: {{ .name | quote }}
app.kubernetes.io/instance: {{ .name | quote }}
{{- end -}}

{{- define "brain-system.apServiceName" -}}
{{- printf "%s-service" .name | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "brain-system.platformAddressPrefix" -}}
{{- $provided := default "" .domainPrefix | lower -}}
{{- if or (eq $provided "brain") (regexMatch "^[a-z]{6}$" $provided) -}}
{{- $provided -}}
{{- else -}}
{{- $source := printf "%s/%s/%s" .namespace .name .id -}}
{{- $letters := regexReplaceAll "[^a-f]" (sha256sum $source | lower) "" -}}
{{- if ge (len $letters) 6 -}}
{{- substr 0 6 $letters -}}
{{- else -}}
{{- substr 0 6 (printf "%saaaaaa" $letters) -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{- define "brain-system.platformAddressHost" -}}
{{- printf "%s.%s" (include "brain-system.platformAddressPrefix" .) .region -}}
{{- end -}}

{{- define "brain-system.firstPlatformAddressHost" -}}
{{- $addresses := default (list) .platformAddresses -}}
{{- if gt (len $addresses) 0 -}}
{{- $address := first $addresses -}}
{{- include "brain-system.platformAddressHost" (dict "namespace" .namespace "name" .name "id" $address.id "region" .region "domainPrefix" $address.domainPrefix) -}}
{{- end -}}
{{- end -}}

{{- define "brain-system.publicUrl" -}}
{{- $host := include "brain-system.firstPlatformAddressHost" . -}}
{{- if $host -}}
{{- printf "https://%s" $host -}}
{{- end -}}
{{- end -}}

{{- define "brain-system.databaseSecretName" -}}
{{- printf "%s-conn-credential" .Values.database.name -}}
{{- end -}}

{{- define "brain-system.publicIngressName" -}}
{{- printf "%s-platform-%s" .name .id | lower | replace "_" "-" | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "brain-system.networkAnnotation" -}}
{{- $addresses := list -}}
{{- $ctx := . -}}
{{- range $address := default (list) .platformAddresses }}
{{- $prefix := include "brain-system.platformAddressPrefix" (dict "namespace" $ctx.namespace "name" $ctx.name "id" $address.id "domainPrefix" $address.domainPrefix) -}}
{{- $addresses = append $addresses (dict "id" $address.id "port" (default $ctx.port $address.port) "domainPrefix" $prefix) -}}
{{- end -}}
{{- $network := dict "privatePort" .port "platformAddresses" $addresses -}}
{{- toJson $network -}}
{{- end -}}

{{- define "brain-system.replicaStrategyAnnotation" -}}
{{- toJson (dict "fixed" (dict "replicas" .replicas) "type" "fixed") -}}
{{- end -}}

{{- define "brain-system.databaseEnv" -}}
{{- $secretName := include "brain-system.databaseSecretName" .root -}}
{{- $database := default "postgres" .root.Values.database.database -}}
{{- $serviceName := printf "%s-postgresql.%s.svc" .root.Values.database.name .root.Release.Namespace -}}
- name: PGUSER
  valueFrom:
    secretKeyRef:
      name: {{ $secretName | quote }}
      key: username
- name: PGPASSWORD
  valueFrom:
    secretKeyRef:
      name: {{ $secretName | quote }}
      key: password
- name: PGHOST
  value: {{ $serviceName | quote }}
- name: PGPORT
  value: "5432"
- name: PGDATABASE
  value: {{ $database | quote }}
- name: DATABASE_URL
  value: {{ printf "postgresql://$(PGUSER):$(PGPASSWORD)@$(PGHOST):$(PGPORT)/%s" $database | quote }}
{{- end -}}

{{- define "brain-system.appEnv" }}
{{- $component := .component -}}
{{- $root := .root -}}
{{ range $key, $value := .env }}
{{ if and $root.Values.database.enabled (eq $key "DATABASE_URL") (eq (toString $value) "") }}
{{ include "brain-system.databaseEnv" (dict "root" $root) }}
{{ else if and (eq $component "ui") (eq $key "API_URL") (eq (toString $value) "") }}
- name: {{ $key }}
  value: {{ include "brain-system.publicUrl" (dict "namespace" $root.Release.Namespace "name" $root.Values.api.name "platformAddresses" $root.Values.api.platformAddresses "region" $root.Values.global.region) | quote }}
{{ else if and (eq $component "ui") (eq $key "NEXT_PUBLIC_APP_URL") (eq (toString $value) "") }}
- name: {{ $key }}
  value: {{ include "brain-system.publicUrl" (dict "namespace" $root.Release.Namespace "name" $root.Values.ui.name "platformAddresses" $root.Values.ui.platformAddresses "region" $root.Values.global.region) | quote }}
{{ else }}
- name: {{ $key }}
  value: {{ $value | quote }}
{{ end }}
{{ end }}
{{ range $key, $value := .staticEnv }}
- name: {{ $key }}
  value: {{ $value | quote }}
{{ end }}
{{- end -}}

{{- define "brain-system.dbProfile" -}}
{{- $engine := lower (default "postgresql" .engine) -}}
{{- if or (eq $engine "postgresql") (eq $engine "postgres") (eq $engine "pg") -}}
clusterDefinition: postgresql
clusterVersion: {{ default "postgresql-16.4.0" .clusterVersion }}
componentName: postgresql
servicePort: 5432
targetPortName: tcp-postgresql
backupMethod: postgres-basebackup
{{- else if or (eq $engine "mysql") (eq $engine "apecloud-mysql") -}}
clusterDefinition: apecloud-mysql
clusterVersion: {{ default "ac-mysql-8.0.30" .clusterVersion }}
componentName: mysql
servicePort: 3306
targetPortName: mysql
backupMethod: xtrabackup
{{- else if eq $engine "redis" -}}
clusterDefinition: redis
clusterVersion: {{ default "redis-7.2.7" .clusterVersion }}
componentName: redis
servicePort: 6379
targetPortName: redis
backupMethod: datafile
{{- else if or (eq $engine "mongodb") (eq $engine "mongo") -}}
clusterDefinition: mongodb
clusterVersion: {{ default "mongodb-6.0" .clusterVersion }}
componentName: mongodb
servicePort: 27017
targetPortName: mongodb
backupMethod: mongodb-dump
{{- else -}}
{{- fail (printf "unsupported database.engine %q" .engine) -}}
{{- end -}}
{{- end -}}

{{- define "brain-system.dbPreset" -}}
{{- $engine := lower (default "postgresql" .engine) -}}
{{- $quota := lower (default "xs" .quota) -}}
{{- if eq $engine "redis" -}}
{{- if eq $quota "l" }}cpuLimit: "4"
cpuRequest: "2"
memoryLimit: 6Gi
memoryRequest: 3Gi
storageSize: 20Gi
{{- else if eq $quota "m" }}cpuLimit: "2"
cpuRequest: "1"
memoryLimit: 3Gi
memoryRequest: 1536Mi
storageSize: 10Gi
{{- else if eq $quota "s" }}cpuLimit: "1"
cpuRequest: 500m
memoryLimit: 1536Mi
memoryRequest: 768Mi
storageSize: 4Gi
{{- else }}cpuLimit: 500m
cpuRequest: 250m
memoryLimit: 768Mi
memoryRequest: 384Mi
storageSize: 3Gi
{{- end -}}
{{- else if eq $engine "mysql" -}}
{{- if eq $quota "l" }}cpuLimit: "4"
cpuRequest: "2"
memoryLimit: 4Gi
memoryRequest: 2Gi
storageSize: 50Gi
{{- else if eq $quota "m" }}cpuLimit: "2"
cpuRequest: "1"
memoryLimit: 2Gi
memoryRequest: 1Gi
storageSize: 20Gi
{{- else if eq $quota "s" }}cpuLimit: "1"
cpuRequest: 500m
memoryLimit: 1Gi
memoryRequest: 512Mi
storageSize: 10Gi
{{- else }}cpuLimit: 500m
cpuRequest: 250m
memoryLimit: 512Mi
memoryRequest: 256Mi
storageSize: 3Gi
{{- end -}}
{{- else if or (eq $engine "mongodb") (eq $engine "mongo") -}}
{{- if eq $quota "l" }}cpuLimit: "4"
cpuRequest: "2"
memoryLimit: 8Gi
memoryRequest: 4Gi
storageSize: 100Gi
{{- else if eq $quota "m" }}cpuLimit: "2"
cpuRequest: "1"
memoryLimit: 4Gi
memoryRequest: 2Gi
storageSize: 50Gi
{{- else if eq $quota "s" }}cpuLimit: "1"
cpuRequest: 500m
memoryLimit: 2Gi
memoryRequest: 1Gi
storageSize: 20Gi
{{- else }}cpuLimit: "1"
cpuRequest: 500m
memoryLimit: 1Gi
memoryRequest: 512Mi
storageSize: 3Gi
{{- end -}}
{{- else -}}
{{- if eq $quota "l" }}cpuLimit: "4"
cpuRequest: "2"
memoryLimit: 8Gi
memoryRequest: 4Gi
storageSize: 100Gi
{{- else if eq $quota "m" }}cpuLimit: "2"
cpuRequest: "1"
memoryLimit: 4Gi
memoryRequest: 2Gi
storageSize: 20Gi
{{- else if eq $quota "s" }}cpuLimit: "1"
cpuRequest: 500m
memoryLimit: 2Gi
memoryRequest: 1Gi
storageSize: 10Gi
{{- else }}cpuLimit: 500m
cpuRequest: 250m
memoryLimit: 1Gi
memoryRequest: 512Mi
storageSize: 3Gi
{{- end -}}
{{- end -}}
{{- end -}}
