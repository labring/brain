package db

import (
	"context"
	"encoding/json"
	"fmt"
	"regexp"
	"strings"

	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/dynamic"
	clientcmdapi "k8s.io/client-go/tools/clientcmd/api"

	"sealos/api/service/orchestration"
	transformdb "sealos/api/service/transform/db"
)

var dnsStyleDBNamePattern = regexp.MustCompile(`^[a-z]([-a-z0-9]*[a-z0-9])?$`)

type RestoreDBOptions struct {
	BackupName      string
	BackupNamespace string
	Namespace       string
	RestoredName    string
	SourceName      string
}

type RestoreDBPlanInput struct {
	Backup       *unstructured.Unstructured
	RestoredName string
	Source       *unstructured.Unstructured
}

type RestoreDBPlan struct {
	BackupName      string
	BackupNamespace string
	Resources       *orchestration.DBResources
	SourceName      string
}

func ValidateDBServiceName(name string) error {
	name = strings.TrimSpace(name)
	if name == "" {
		return fmt.Errorf("DB Service name is required")
	}
	if len(name) > 63 || !dnsStyleDBNamePattern.MatchString(name) {
		return fmt.Errorf("DB Service name must use lowercase letters, numbers, and hyphens, start with a letter, and end with a letter or number")
	}
	return nil
}

func BuildRestoreDBPlan(input RestoreDBPlanInput) (*RestoreDBPlan, error) {
	if input.Source == nil {
		return nil, fmt.Errorf("source DB Service is required")
	}
	if input.Backup == nil {
		return nil, fmt.Errorf("DB Service Backup is required")
	}
	restoredName := strings.TrimSpace(input.RestoredName)
	if err := ValidateDBServiceName(restoredName); err != nil {
		return nil, err
	}
	if restoredName == input.Source.GetName() {
		return nil, fmt.Errorf("restored DB Service name must be different from the source DB Service")
	}
	if !backupIsCompleted(input.Backup) {
		return nil, fmt.Errorf("DB Service Restore requires a completed DB Service Backup")
	}
	if err := backupBelongsToSourceCluster(input.Backup, input.Source); err != nil {
		return nil, err
	}
	renderInput, err := restoreRenderInputFromSource(input.Source, input.Backup, restoredName)
	if err != nil {
		return nil, err
	}
	resources, err := orchestration.RenderDBResources(renderInput)
	if err != nil {
		return nil, err
	}
	return &RestoreDBPlan{
		BackupName:      input.Backup.GetName(),
		BackupNamespace: input.Backup.GetNamespace(),
		Resources:       resources,
		SourceName:      input.Source.GetName(),
	}, nil
}

func RestoreDBFromBackup(cfg *clientcmdapi.Config, opts RestoreDBOptions) ([]byte, error) {
	if cfg == nil {
		return nil, fmt.Errorf("kubeconfig is required")
	}
	sourceName := strings.TrimSpace(opts.SourceName)
	restoredName := strings.TrimSpace(opts.RestoredName)
	namespace := strings.TrimSpace(opts.Namespace)
	backupName := strings.TrimSpace(opts.BackupName)
	backupNamespace := strings.TrimSpace(opts.BackupNamespace)
	if sourceName == "" || namespace == "" || backupName == "" {
		return nil, fmt.Errorf("source DB Service, namespace, and backup name are required")
	}
	if backupNamespace == "" {
		backupNamespace = namespace
	}
	if err := ValidateDBServiceName(restoredName); err != nil {
		return nil, err
	}

	restConfig, ns, err := restConfigAndNamespaceForDBBackup(cfg, namespace)
	if err != nil {
		return nil, err
	}
	namespace = ns
	client, err := dynamic.NewForConfig(restConfig)
	if err != nil {
		return nil, err
	}
	ctx := context.Background()
	clusters := client.Resource(kubeBlocksClusterGVR).Namespace(namespace)
	backups := client.Resource(kubeBlocksBackupGVR).Namespace(backupNamespace)

	source, err := clusters.Get(ctx, sourceName, metav1.GetOptions{})
	if err != nil {
		return nil, fmt.Errorf("source DB Service %s not found: %w", sourceName, err)
	}
	if err := requireBrainManagedRestoreSource(source); err != nil {
		return nil, err
	}
	if _, err := clusters.Get(ctx, restoredName, metav1.GetOptions{}); err == nil {
		return nil, apierrors.NewAlreadyExists(schema.GroupResource{Group: "apps.kubeblocks.io", Resource: "clusters"}, restoredName)
	} else if !apierrors.IsNotFound(err) {
		return nil, err
	}
	backup, err := backups.Get(ctx, backupName, metav1.GetOptions{})
	if err != nil {
		return nil, fmt.Errorf("DB Service Backup %s not found: %w", backupName, err)
	}
	plan, err := BuildRestoreDBPlan(RestoreDBPlanInput{
		Backup:       backup,
		RestoredName: restoredName,
		Source:       source,
	})
	if err != nil {
		return nil, err
	}
	created, err := clusters.Create(ctx, plan.Resources.Cluster, metav1.CreateOptions{})
	if err != nil {
		return nil, err
	}
	return json.Marshal(created.Object)
}

func restoreRenderInputFromSource(source *unstructured.Unstructured, backup *unstructured.Unstructured, restoredName string) (orchestration.DBResourcesInput, error) {
	if source.GetNamespace() == "" {
		return orchestration.DBResourcesInput{}, fmt.Errorf("source DB Service namespace is required")
	}
	projectID := strings.TrimSpace(source.GetLabels()[orchestration.BrainProjectIDLabel])
	if projectID == "" {
		return orchestration.DBResourcesInput{}, fmt.Errorf("source DB Service projectId is required")
	}
	engine := engineFromCluster(source.Object)
	if engine == "" {
		return orchestration.DBResourcesInput{}, fmt.Errorf("source DB Service engine is required")
	}
	component := dbPrimaryComponentForRestore(source, engine)
	return orchestration.DBResourcesInput{
		BackupPolicy:   restoreBackupPolicy(source),
		CPULimit:       nestedString(component, "resources", "limits", "cpu"),
		CPURequest:     nestedString(component, "resources", "requests", "cpu"),
		ClusterVersion: restoreClusterVersion(source),
		Engine:         engine,
		MemoryLimit:    nestedString(component, "resources", "limits", "memory"),
		MemoryRequest:  nestedString(component, "resources", "requests", "memory"),
		Name:           restoredName,
		Namespace:      source.GetNamespace(),
		ProjectID:      projectID,
		Replicas:       nestedInt64(component, "replicas"),
		RestoreFromBackup: &orchestration.DBRestoreFromBackupInput{
			BackupName:      backup.GetName(),
			BackupNamespace: backup.GetNamespace(),
		},
		StorageSize: restoreStorageSize(component),
	}, nil
}

func restoreBackupPolicy(source *unstructured.Unstructured) map[string]interface{} {
	policy, found, _ := unstructured.NestedMap(source.Object, "spec", "backup")
	if !found || len(policy) == 0 {
		return nil
	}
	return policy
}

func restoreClusterVersion(source *unstructured.Unstructured) string {
	version := nestedString(source.Object, "spec", "clusterVersionRef")
	if version != "" {
		return version
	}
	return strings.TrimSpace(source.GetLabels()[orchestration.DBProviderClusterVersionLabel])
}

func backupIsCompleted(backup *unstructured.Unstructured) bool {
	phase, _, _ := unstructured.NestedString(backup.Object, "status", "phase")
	phase = strings.ToLower(strings.TrimSpace(phase))
	if phase == "completed" || phase == "succeeded" {
		return true
	}
	conditions, found, _ := unstructured.NestedSlice(backup.Object, "status", "conditions")
	if !found {
		return false
	}
	for _, item := range conditions {
		condition, _ := item.(map[string]interface{})
		if condition == nil {
			continue
		}
		conditionType := strings.ToLower(strings.TrimSpace(stringFromInterface(condition["type"])))
		status := strings.ToLower(strings.TrimSpace(stringFromInterface(condition["status"])))
		if (conditionType == "completed" || conditionType == "complete") && status == "true" {
			return true
		}
	}
	return false
}

func backupBelongsToSourceCluster(backup *unstructured.Unstructured, source *unstructured.Unstructured) error {
	if backup.GetNamespace() == "" || source.GetNamespace() == "" || backup.GetNamespace() != source.GetNamespace() {
		return fmt.Errorf("DB Service Backup must be in the same namespace as the source DB Service")
	}
	sourceUID := string(source.GetUID())
	if sourceUID == "" {
		sourceUID, _, _ = unstructured.NestedString(source.Object, "metadata", "uid")
	}
	if sourceUID == "" {
		return fmt.Errorf("source DB Service UID is required")
	}
	backupClusterUID := strings.TrimSpace(backup.GetLabels()[transformdb.KubeBlocksBackupClusterUIDLabel])
	if backupClusterUID != sourceUID {
		return fmt.Errorf("DB Service Backup does not belong to the source DB Service")
	}
	return nil
}

func requireBrainManagedRestoreSource(cluster *unstructured.Unstructured) error {
	if cluster == nil {
		return fmt.Errorf("source DB Service is required")
	}
	labels := cluster.GetLabels()
	if labels[orchestration.BrainManagedByLabel] != orchestration.BrainManagedByValue ||
		labels[orchestration.BrainResourceKindLabel] != orchestration.ResourceKindDB ||
		strings.TrimSpace(labels[orchestration.BrainProjectIDLabel]) == "" {
		return fmt.Errorf("source DB Service is not a Brain-managed DB")
	}
	return nil
}

func dbPrimaryComponentForRestore(cluster *unstructured.Unstructured, engine string) map[string]interface{} {
	components, found, _ := unstructured.NestedSlice(cluster.Object, "spec", "componentSpecs")
	if !found || len(components) == 0 {
		return nil
	}
	if profile, ok := orchestration.DBEngineProfileFor(engine); ok {
		for _, item := range components {
			component, _ := item.(map[string]interface{})
			if component == nil {
				continue
			}
			if strings.TrimSpace(stringFromInterface(component["name"])) == profile.ComponentName ||
				strings.TrimSpace(stringFromInterface(component["componentDefRef"])) == profile.ComponentName {
				return component
			}
		}
	}
	component, _ := components[0].(map[string]interface{})
	return component
}

func restoreStorageSize(component map[string]interface{}) string {
	templates, found, _ := unstructured.NestedSlice(component, "volumeClaimTemplates")
	if !found || len(templates) == 0 {
		return ""
	}
	template, _ := templates[0].(map[string]interface{})
	return nestedString(template, "spec", "resources", "requests", "storage")
}

func nestedString(values map[string]interface{}, fields ...string) string {
	value, _, _ := unstructured.NestedString(values, fields...)
	return strings.TrimSpace(value)
}

func nestedInt64(values map[string]interface{}, fields ...string) int64 {
	value, found, _ := unstructured.NestedInt64(values, fields...)
	if found {
		return value
	}
	raw, found, _ := unstructured.NestedFieldNoCopy(values, fields...)
	if !found {
		return 0
	}
	switch typed := raw.(type) {
	case int:
		return int64(typed)
	case int32:
		return int64(typed)
	case int64:
		return typed
	case float64:
		rounded := int64(typed)
		if typed == float64(rounded) {
			return rounded
		}
	}
	return 0
}

func stringFromInterface(value interface{}) string {
	str, _ := value.(string)
	return str
}
