package orchestration

import "strings"

const (
	BrainManagedByLabel      = "brain.io/managed-by"
	BrainManagedByValue      = "brain"
	BrainProjectIDLabel      = "brain.io/project-id"
	BrainDeploymentKindLabel = "brain.io/deployment-kind"
	BrainDeploymentNameLabel = "brain.io/deployment-name"
	BrainTemplateNameLabel   = "brain.io/template-name"
	BrainDBEngineLabel       = "brain.io/db-engine"
	// BrainDisplayNameAnnotation stores the Resource Display Name (ADR 0062);
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

// MaxDisplayNameLength bounds a stored Resource Display Name (ADR 0062:
// "Trimmed, 1–256 characters"), matching the UI module's bound.
const MaxDisplayNameLength = 256

// DisplayNameAnnotationPatchValue normalizes a Resource Display Name value
// from a product merge patch (ADR 0062): a non-empty string sets the trimmed
// name, truncated to MaxDisplayNameLength like the UI read path; an empty or
// null value becomes merge-patch nil, deleting the annotation and restoring
// the Kubernetes name.
func DisplayNameAnnotationPatchValue(raw interface{}) interface{} {
	value, _ := raw.(string)
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return nil
	}
	if runes := []rune(trimmed); len(runes) > MaxDisplayNameLength {
		return strings.TrimSpace(string(runes[:MaxDisplayNameLength]))
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
