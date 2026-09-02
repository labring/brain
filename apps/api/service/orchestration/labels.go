package orchestration

import (
	"errors"
	"fmt"
	"strings"
	"unicode/utf8"
)

const (
	BrainManagedByLabel      = "brain.io/managed-by"
	BrainManagedByValue      = "brain"
	BrainProjectIDLabel      = "brain.io/project-id"
	BrainDeploymentKindLabel = "brain.io/deployment-kind"
	BrainDeploymentNameLabel = "brain.io/deployment-name"
	BrainTemplateNameLabel   = "brain.io/template-name"
	BrainDBEngineLabel       = "brain.io/db-engine"
	// BrainDisplayNameAnnotation stores the Resource Display Name (ADR 0066);
	// display-only, never a selector or identity.
	BrainDisplayNameAnnotation = "brain.io/display-name"

	APDesiredNetworkAnnotation    = "brain.io/ap-desired-network"
	APConfigMapChecksumAnnotation = "brain.io/ap-config-checksum"
	APEnvRawSourceAnnotation      = "brain.io/ap-env-raw-source"
	APReplicaStrategyAnnotation   = "brain.io/ap-replica-strategy"
	APDesiredStorageAnnotation    = "brain.io/ap-desired-storage"
	APRestartRequestAnnotation    = "brain.io/ap-restart-request"
	APRoutingDomainLabel          = "region"

	DeploymentKindAP       = "ap"
	DeploymentKindDB       = "db"
	DeploymentKindTemplate = "template"

	LaunchpadAppDeployManagerLabel                = "cloud.sealos.io/app-deploy-manager"
	LaunchpadAppDeployManagerDomainLabel          = "cloud.sealos.io/app-deploy-manager-domain"
	LaunchpadAppDeployManagerDomainHostAnnotation = "cloud.sealos.io/app-deploy-manager-domain-host"
	LaunchpadAppLabel                             = "app"
	LaunchpadPauseAnnotation                      = "deploy.cloud.sealos.io/pause"
	LaunchpadMinReplicasAnnotation                = "deploy.cloud.sealos.io/minReplicas"
	LaunchpadMaxReplicasAnnotation                = "deploy.cloud.sealos.io/maxReplicas"
	LaunchpadResizeAnnotation                     = "deploy.cloud.sealos.io/resize"

	DBProviderInstanceLabel          = "app.kubernetes.io/instance"
	DBProviderClusterDefinitionLabel = "clusterdefinition.kubeblocks.io/name"
	DBProviderClusterVersionLabel    = "clusterversion.kubeblocks.io/name"
	DBProviderCRLabel                = "sealos-db-provider-cr"
	DBProviderManagedByLabel         = "app.kubernetes.io/managed-by"
	DBProviderManagedByValue         = "kbcli"

	// KubeBlocksBackupClusterUIDLabel is the label on Backup resources that
	// references the KubeBlocks Cluster UID.
	KubeBlocksBackupClusterUIDLabel = "dataprotection.kubeblocks.io/cluster-uid"
)

func mergeStringMap(maps ...map[string]string) map[string]string {
	out := map[string]string{}
	for _, item := range maps {
		for key, value := range item {
			if value != "" {
				out[key] = value
			}
		}
	}
	return out
}

// MaxDisplayNameLength bounds a stored Resource Display Name (ADR 0066:
// "Trimmed, 1–256 characters"), counted in Unicode code points on both
// sides of the API — keep in step with the UI module
// (apps/ui/src/features/resource-display-name/resource-display-name.ts).
const MaxDisplayNameLength = 256

// DisplayNameAnnotationPatchValue validates a Resource Display Name value
// from a product merge patch, mirroring the UI module's submit rules
// (ADR 0066): a display name is only ever set, never cleared, so an empty
// or null value is rejected instead of deleting the annotation; an
// over-long value is rejected instead of truncated.
func DisplayNameAnnotationPatchValue(raw interface{}) (string, error) {
	value, _ := raw.(string)
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return "", errors.New("a Resource Display Name can only be set, never cleared; send a non-empty name")
	}
	if utf8.RuneCountInString(trimmed) > MaxDisplayNameLength {
		return "", fmt.Errorf("a Resource Display Name is at most %d characters", MaxDisplayNameLength)
	}
	return trimmed, nil
}

// DisplayNameAnnotationCreateValue bounds a Resource Display Name arriving
// on a create manifest (ADR 0066). Unlike the patch path, an invalid value
// never fails the create — naming must not block a deploy — so an over-long
// value is dropped and the resource shows its Kubernetes name instead.
func DisplayNameAnnotationCreateValue(raw string) string {
	trimmed := strings.TrimSpace(raw)
	if utf8.RuneCountInString(trimmed) > MaxDisplayNameLength {
		return ""
	}
	return trimmed
}

func brainLabels(projectID, deploymentKind, deploymentName string) map[string]string {
	return map[string]string{
		BrainManagedByLabel:      BrainManagedByValue,
		BrainProjectIDLabel:      projectID,
		BrainDeploymentKindLabel: deploymentKind,
		BrainDeploymentNameLabel: deploymentName,
	}
}
