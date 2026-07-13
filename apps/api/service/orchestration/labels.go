package orchestration

const (
	BrainManagedByLabel      = "brain.io/managed-by"
	BrainManagedByValue      = "brain"
	BrainProjectIDLabel      = "brain.io/project-id"
	BrainDeploymentKindLabel = "brain.io/deployment-kind"
	BrainDeploymentNameLabel = "brain.io/deployment-name"
	BrainTemplateNameLabel   = "brain.io/template-name"
	BrainDBEngineLabel       = "brain.io/db-engine"

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

func brainLabels(projectID, deploymentKind, deploymentName string) map[string]string {
	return map[string]string{
		BrainManagedByLabel:      BrainManagedByValue,
		BrainProjectIDLabel:      projectID,
		BrainDeploymentKindLabel: deploymentKind,
		BrainDeploymentNameLabel: deploymentName,
	}
}
