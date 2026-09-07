package orchestration

import (
	"errors"
	"fmt"
	"strconv"
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
	// BrainPortDisplayNameAnnotationPrefix prefixes the per-port Port Display
	// Name annotations on an AP's Service (ADR 0080): the full key is
	// "brain.io/port-display-name.<port number>". Display-only, like the
	// Resource Display Name.
	BrainPortDisplayNameAnnotationPrefix = "brain.io/port-display-name."
	// BrainDefaultOpenPortAnnotation stores the Default Open Port on an AP's
	// Service (ADR 0080's store): the App Listening Port number whose best
	// Public Address the Open control opens. Display-only; a value naming a
	// port the AP no longer listens on is ignored at read time.
	BrainDefaultOpenPortAnnotation = "brain.io/default-open-port"

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

// BrainPortDisplayNameAnnotation returns the Service annotation key that
// stores the Port Display Name of one App Listening Port (ADR 0080).
func BrainPortDisplayNameAnnotation(port int32) string {
	return BrainPortDisplayNameAnnotationPrefix + strconv.FormatInt(int64(port), 10)
}

// MaxPortDisplayNameLength bounds a stored Port Display Name (ADR 0080:
// "trimmed, 1–64 characters, any script"), counted in Unicode code points.
const MaxPortDisplayNameLength = 64

// PortDisplayNameValue validates one Port Display Name value from a product
// manifest or merge patch (ADR 0080). Unlike a Resource Display Name, an empty
// or null value is valid: it means "no name" and clears the port's annotation.
// An over-long value is rejected instead of truncated; the PATCH route
// surfaces that error while the create path drops the name.
func PortDisplayNameValue(raw interface{}) (string, error) {
	if raw == nil {
		return "", nil
	}
	value, ok := raw.(string)
	if !ok {
		return "", errors.New("a Port Display Name must be a string")
	}
	trimmed := strings.TrimSpace(value)
	if utf8.RuneCountInString(trimmed) > MaxPortDisplayNameLength {
		return "", fmt.Errorf("a Port Display Name is at most %d characters", MaxPortDisplayNameLength)
	}
	return trimmed, nil
}

// DefaultOpenPortValue reads one Default Open Port value from a product
// manifest or merge patch. A nil value is valid and means "no stored choice"
// (present is false); anything else must be a port number from 1 through
// 65535, read with the same leniency as an App Listening Port's "port" (a
// numeric string is accepted). Whether the port is one of the AP's App
// Listening Ports is checked by the caller against the normalized port list.
func DefaultOpenPortValue(raw interface{}) (port int32, present bool, err error) {
	if raw == nil {
		return 0, false, nil
	}
	port, ok := APPortFromInterface(raw)
	if !ok {
		return 0, true, errors.New("defaultOpenPort must be an App Listening Port number from 1 through 65535")
	}
	return port, true, nil
}

func brainLabels(projectID, deploymentKind, deploymentName string) map[string]string {
	return map[string]string{
		BrainManagedByLabel:      BrainManagedByValue,
		BrainProjectIDLabel:      projectID,
		BrainDeploymentKindLabel: deploymentKind,
		BrainDeploymentNameLabel: deploymentName,
	}
}
