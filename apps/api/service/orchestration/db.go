package orchestration

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"

	corev1 "k8s.io/api/core/v1"
	rbacv1 "k8s.io/api/rbac/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/util/intstr"
)

type DBResourcesInput struct {
	BackupPolicy      map[string]interface{}
	CPULimit          string
	CPURequest        string
	ClusterVersion    string
	Engine            string
	ExposeNodePort    bool
	MemoryLimit       string
	MemoryRequest     string
	Name              string
	Namespace         string
	ProjectID         string
	Quota             string
	Replicas          int64
	RestoreFromBackup *DBRestoreFromBackupInput
	StorageSize       string
}

type DBRestoreFromBackupInput struct {
	BackupName      string
	BackupNamespace string
}

type DBVerticalScalingInput struct {
	CPULimit      string
	CPURequest    string
	MemoryLimit   string
	MemoryRequest string
}

func RenderDBRestartOpsRequest(name, namespace, engine string, now time.Time) (*unstructured.Unstructured, error) {
	return RenderDBBasicOpsRequest(name, namespace, engine, "Restart", now)
}

func RenderDBBasicOpsRequest(name, namespace, engine, opsType string, now time.Time) (*unstructured.Unstructured, error) {
	name = strings.TrimSpace(name)
	namespace = strings.TrimSpace(namespace)
	opsType = strings.TrimSpace(opsType)
	if name == "" || namespace == "" {
		return nil, fmt.Errorf("name and namespace are required")
	}
	profile, ok := DBEngineProfileFor(engine)
	if !ok {
		return nil, fmt.Errorf("unsupported DB engine %q", engine)
	}
	if opsType == "" {
		return nil, fmt.Errorf("ops type is required")
	}
	suffix := now.UTC().Format("20060102150405")
	spec := map[string]interface{}{
		"clusterRef": name,
		"type":       opsType,
	}
	if opsType == "Restart" {
		spec["restart"] = []interface{}{
			map[string]interface{}{"componentName": profile.ComponentName},
		}
	}
	return dbOpsRequest(name, namespace, strings.ToLower(opsType), suffix, spec), nil
}

func RenderDBHorizontalScalingOpsRequest(name, namespace, engine string, replicas int64, now time.Time) (*unstructured.Unstructured, error) {
	name = strings.TrimSpace(name)
	namespace = strings.TrimSpace(namespace)
	if name == "" || namespace == "" {
		return nil, fmt.Errorf("name and namespace are required")
	}
	profile, ok := DBEngineProfileFor(engine)
	if !ok {
		return nil, fmt.Errorf("unsupported DB engine %q", engine)
	}
	if replicas < 1 {
		return nil, fmt.Errorf("replicas must be a positive integer")
	}
	spec := map[string]interface{}{
		"clusterRef": name,
		"horizontalScaling": []interface{}{
			map[string]interface{}{
				"componentName": profile.ComponentName,
				"replicas":      replicas,
			},
		},
		"type": "HorizontalScaling",
	}
	return dbOpsRequest(name, namespace, "horizontalscaling", now.UTC().Format("20060102150405"), spec), nil
}

func RenderDBVolumeExpansionOpsRequest(name, namespace, engine, storageSize string, now time.Time) (*unstructured.Unstructured, error) {
	name = strings.TrimSpace(name)
	namespace = strings.TrimSpace(namespace)
	storageSize = strings.TrimSpace(storageSize)
	if name == "" || namespace == "" {
		return nil, fmt.Errorf("name and namespace are required")
	}
	profile, ok := DBEngineProfileFor(engine)
	if !ok {
		return nil, fmt.Errorf("unsupported DB engine %q", engine)
	}
	if storageSize == "" {
		return nil, fmt.Errorf("storage size is required")
	}
	spec := map[string]interface{}{
		"clusterRef": name,
		"type":       "VolumeExpansion",
		"volumeExpansion": []interface{}{
			map[string]interface{}{
				"componentName": profile.ComponentName,
				"volumeClaimTemplates": []interface{}{
					map[string]interface{}{
						"name":    "data",
						"storage": storageSize,
					},
				},
			},
		},
	}
	return dbOpsRequest(name, namespace, "volumeexpansion", now.UTC().Format("20060102150405"), spec), nil
}

func RenderDBVerticalScalingOpsRequest(name, namespace, engine string, input DBVerticalScalingInput, now time.Time) (*unstructured.Unstructured, error) {
	name = strings.TrimSpace(name)
	namespace = strings.TrimSpace(namespace)
	if name == "" || namespace == "" {
		return nil, fmt.Errorf("name and namespace are required")
	}
	profile, ok := DBEngineProfileFor(engine)
	if !ok {
		return nil, fmt.Errorf("unsupported DB engine %q", engine)
	}
	requests := map[string]interface{}{}
	limits := map[string]interface{}{}
	if value := strings.TrimSpace(input.CPURequest); value != "" {
		requests["cpu"] = value
	}
	if value := strings.TrimSpace(input.MemoryRequest); value != "" {
		requests["memory"] = value
	}
	if value := strings.TrimSpace(input.CPULimit); value != "" {
		limits["cpu"] = value
	}
	if value := strings.TrimSpace(input.MemoryLimit); value != "" {
		limits["memory"] = value
	}
	if len(requests) == 0 && len(limits) == 0 {
		return nil, fmt.Errorf("at least one resource request or limit is required")
	}
	component := map[string]interface{}{
		"componentName": profile.ComponentName,
	}
	if len(requests) > 0 {
		component["requests"] = requests
	}
	if len(limits) > 0 {
		component["limits"] = limits
	}
	spec := map[string]interface{}{
		"clusterRef":      name,
		"type":            "VerticalScaling",
		"verticalScaling": []interface{}{component},
	}
	return dbOpsRequest(name, namespace, "verticalscaling", now.UTC().Format("20060102150405"), spec), nil
}

func dbOpsRequest(clusterName, namespace, operation, suffix string, spec map[string]interface{}) *unstructured.Unstructured {
	return &unstructured.Unstructured{
		Object: map[string]interface{}{
			"apiVersion": "apps.kubeblocks.io/v1alpha1",
			"kind":       "OpsRequest",
			"metadata": map[string]interface{}{
				"labels": map[string]interface{}{
					DBProviderCRLabel:       clusterName,
					DBProviderInstanceLabel: clusterName,
				},
				"name":      clusterName + "-" + operation + "-" + suffix,
				"namespace": namespace,
			},
			"spec": spec,
		},
	}
}

type DBResources struct {
	Cluster        *unstructured.Unstructured
	ExportService  *corev1.Service
	ServiceAccount *corev1.ServiceAccount
	Role           *rbacv1.Role
	RoleBinding    *rbacv1.RoleBinding
}

func RenderDBResources(input DBResourcesInput) (*DBResources, error) {
	name := strings.TrimSpace(input.Name)
	namespace := strings.TrimSpace(input.Namespace)
	projectID := strings.TrimSpace(input.ProjectID)
	engine := strings.TrimSpace(input.Engine)
	profile, ok := DBEngineProfileFor(engine)
	if !ok {
		return nil, fmt.Errorf("unsupported DB engine %q", engine)
	}
	version := strings.TrimSpace(input.ClusterVersion)
	if version == "" {
		version = profile.ClusterVersion
	}
	if name == "" || namespace == "" || projectID == "" || engine == "" {
		return nil, fmt.Errorf("name, namespace, projectID, and engine are required")
	}
	replicas := input.Replicas
	if replicas < 1 {
		replicas = 1
	}
	storageSize := strings.TrimSpace(input.StorageSize)
	if storageSize == "" {
		storageSize = dbResourcePreset(profile.Engine, input.Quota).StorageSize
	}
	componentResources := dbComponentResources(profile.Engine, input)
	if componentResources == nil {
		componentResources = dbComponentResources(profile.Engine, DBResourcesInput{Quota: input.Quota})
	}
	componentSpec := map[string]interface{}{
		"componentDefRef":    profile.ComponentName,
		"name":               profile.ComponentName,
		"replicas":           replicas,
		"serviceAccountName": name,
		"volumeClaimTemplates": []interface{}{
			map[string]interface{}{
				"name": "data",
				"spec": map[string]interface{}{
					"accessModes": []interface{}{"ReadWriteOnce"},
					"resources": map[string]interface{}{
						"requests": map[string]interface{}{
							"storage": storageSize,
						},
					},
				},
			},
		},
	}
	if componentResources != nil {
		componentSpec["resources"] = componentResources
	}
	labels := mergeStringMap(
		brainLabels(projectID, DeploymentKindDB, name),
		map[string]string{
			BrainDBEngineLabel:               engine,
			DBProviderClusterDefinitionLabel: profile.ClusterDefinition,
			DBProviderClusterVersionLabel:    version,
			DBProviderCRLabel:                name,
			DBProviderInstanceLabel:          name,
		},
	)
	cluster := &unstructured.Unstructured{
		Object: map[string]interface{}{
			"apiVersion": "apps.kubeblocks.io/v1alpha1",
			"kind":       "Cluster",
			"metadata": map[string]interface{}{
				"name":      name,
				"namespace": namespace,
			},
			"spec": map[string]interface{}{
				"clusterDefinitionRef": profile.ClusterDefinition,
				"clusterVersionRef":    version,
				"componentSpecs":       []interface{}{componentSpec},
				"terminationPolicy":    "Delete",
			},
		},
	}
	if len(input.BackupPolicy) > 0 {
		spec := cluster.Object["spec"].(map[string]interface{})
		spec["backup"] = input.BackupPolicy
	}
	cluster.SetGroupVersionKind(schema.GroupVersionKind{
		Group:   "apps.kubeblocks.io",
		Version: "v1alpha1",
		Kind:    "Cluster",
	})
	cluster.SetLabels(labels)
	if input.RestoreFromBackup != nil {
		if err := applyDBRestoreFromBackupAnnotation(cluster, profile.ComponentName, input.RestoreFromBackup); err != nil {
			return nil, err
		}
	}

	var exportService *corev1.Service
	if input.ExposeNodePort {
		exportService = RenderDBExportService(name, namespace, engine, labels)
	}

	serviceAccount, role, roleBinding := RenderDBAccountResources(name, namespace, labels)

	return &DBResources{
		Cluster:        cluster,
		ExportService:  exportService,
		ServiceAccount: serviceAccount,
		Role:           role,
		RoleBinding:    roleBinding,
	}, nil
}

// RenderDBAccountResources renders the per-DB ServiceAccount, Role, and RoleBinding that the
// KubeBlocks Cluster's pods run as. The Cluster's componentSpec references this account through
// serviceAccountName, so KubeBlocks lifecycle, probe, and reconfigure sidecars get the in-namespace
// permissions they need. This mirrors the legacy sealos dbprovider account template; the objects
// carry Brain ownership labels so db-delete's label sweep reclaims them with the Cluster, plus
// app.kubernetes.io/managed-by=kbcli for parity with the legacy sealos dbprovider account objects.
func RenderDBAccountResources(name, namespace string, labels map[string]string) (*corev1.ServiceAccount, *rbacv1.Role, *rbacv1.RoleBinding) {
	accountLabels := mergeStringMap(labels, map[string]string{
		DBProviderManagedByLabel: DBProviderManagedByValue,
	})
	serviceAccount := &corev1.ServiceAccount{
		TypeMeta: metav1.TypeMeta{APIVersion: "v1", Kind: "ServiceAccount"},
		ObjectMeta: metav1.ObjectMeta{
			Labels:    accountLabels,
			Name:      name,
			Namespace: namespace,
		},
	}
	role := &rbacv1.Role{
		TypeMeta: metav1.TypeMeta{APIVersion: "rbac.authorization.k8s.io/v1", Kind: "Role"},
		ObjectMeta: metav1.ObjectMeta{
			Labels:    accountLabels,
			Name:      name,
			Namespace: namespace,
		},
		Rules: []rbacv1.PolicyRule{
			{APIGroups: []string{"*"}, Resources: []string{"*"}, Verbs: []string{"*"}},
		},
	}
	roleBinding := &rbacv1.RoleBinding{
		TypeMeta: metav1.TypeMeta{APIVersion: "rbac.authorization.k8s.io/v1", Kind: "RoleBinding"},
		ObjectMeta: metav1.ObjectMeta{
			Labels:    accountLabels,
			Name:      name,
			Namespace: namespace,
		},
		RoleRef: rbacv1.RoleRef{
			APIGroup: "rbac.authorization.k8s.io",
			Kind:     "Role",
			Name:     name,
		},
		Subjects: []rbacv1.Subject{
			{Kind: "ServiceAccount", Name: name, Namespace: namespace},
		},
	}
	return serviceAccount, role, roleBinding
}

func applyDBRestoreFromBackupAnnotation(cluster *unstructured.Unstructured, componentName string, input *DBRestoreFromBackupInput) error {
	backupName := strings.TrimSpace(input.BackupName)
	backupNamespace := strings.TrimSpace(input.BackupNamespace)
	componentName = strings.TrimSpace(componentName)
	if backupName == "" || backupNamespace == "" || componentName == "" {
		return fmt.Errorf("backup name, backup namespace, and component name are required")
	}
	restore := map[string]interface{}{
		componentName: map[string]interface{}{
			"name":                backupName,
			"namespace":           backupNamespace,
			"volumeRestorePolicy": "Parallel",
		},
	}
	annotation, err := json.Marshal(restore)
	if err != nil {
		return err
	}
	annotations := cluster.GetAnnotations()
	if annotations == nil {
		annotations = map[string]string{}
	}
	annotations["kubeblocks.io/restore-from-backup"] = string(annotation)
	cluster.SetAnnotations(annotations)
	return nil
}

type dbResourcePresetValues struct {
	CPULimit      string
	CPURequest    string
	MemoryLimit   string
	MemoryRequest string
	StorageSize   string
}

func dbResourcePreset(engine string, quota string) dbResourcePresetValues {
	normalizedEngine := strings.ToLower(strings.TrimSpace(engine))
	normalizedQuota := strings.ToLower(strings.TrimSpace(quota))
	if normalizedQuota == "" {
		normalizedQuota = "xs"
	}
	presets := map[string]map[string]dbResourcePresetValues{
		"mongodb": {
			"xs": {CPULimit: "1", CPURequest: "500m", MemoryLimit: "1Gi", MemoryRequest: "512Mi", StorageSize: "3Gi"},
			"s":  {CPULimit: "1", CPURequest: "500m", MemoryLimit: "2Gi", MemoryRequest: "1Gi", StorageSize: "20Gi"},
			"m":  {CPULimit: "2", CPURequest: "1", MemoryLimit: "4Gi", MemoryRequest: "2Gi", StorageSize: "50Gi"},
			"l":  {CPULimit: "4", CPURequest: "2", MemoryLimit: "8Gi", MemoryRequest: "4Gi", StorageSize: "100Gi"},
		},
		"mysql": {
			"xs": {CPULimit: "500m", CPURequest: "250m", MemoryLimit: "512Mi", MemoryRequest: "256Mi", StorageSize: "3Gi"},
			"s":  {CPULimit: "1", CPURequest: "500m", MemoryLimit: "1Gi", MemoryRequest: "512Mi", StorageSize: "10Gi"},
			"m":  {CPULimit: "2", CPURequest: "1", MemoryLimit: "2Gi", MemoryRequest: "1Gi", StorageSize: "20Gi"},
			"l":  {CPULimit: "4", CPURequest: "2", MemoryLimit: "4Gi", MemoryRequest: "2Gi", StorageSize: "50Gi"},
		},
		"postgresql": {
			"xs": {CPULimit: "500m", CPURequest: "250m", MemoryLimit: "1Gi", MemoryRequest: "512Mi", StorageSize: "3Gi"},
			"s":  {CPULimit: "1", CPURequest: "500m", MemoryLimit: "2Gi", MemoryRequest: "1Gi", StorageSize: "10Gi"},
			"m":  {CPULimit: "2", CPURequest: "1", MemoryLimit: "4Gi", MemoryRequest: "2Gi", StorageSize: "20Gi"},
			"l":  {CPULimit: "4", CPURequest: "2", MemoryLimit: "8Gi", MemoryRequest: "4Gi", StorageSize: "50Gi"},
		},
		"redis": {
			"xs": {CPULimit: "500m", CPURequest: "250m", MemoryLimit: "768Mi", MemoryRequest: "384Mi", StorageSize: "3Gi"},
			"s":  {CPULimit: "1", CPURequest: "500m", MemoryLimit: "1536Mi", MemoryRequest: "768Mi", StorageSize: "4Gi"},
			"m":  {CPULimit: "2", CPURequest: "1", MemoryLimit: "3Gi", MemoryRequest: "1536Mi", StorageSize: "10Gi"},
			"l":  {CPULimit: "4", CPURequest: "2", MemoryLimit: "6Gi", MemoryRequest: "3Gi", StorageSize: "20Gi"},
		},
	}
	if enginePresets, ok := presets[normalizedEngine]; ok {
		if preset, ok := enginePresets[normalizedQuota]; ok {
			return preset
		}
		return enginePresets["xs"]
	}
	return presets["postgresql"]["xs"]
}

func dbComponentResources(engine string, input DBResourcesInput) map[string]interface{} {
	preset := dbResourcePreset(engine, input.Quota)
	cpuLimit := firstNonEmpty(input.CPULimit, preset.CPULimit)
	cpuRequest := firstNonEmpty(input.CPURequest, preset.CPURequest)
	memoryLimit := firstNonEmpty(input.MemoryLimit, preset.MemoryLimit)
	memoryRequest := firstNonEmpty(input.MemoryRequest, preset.MemoryRequest)
	requests := map[string]interface{}{}
	if cpuRequest != "" {
		requests["cpu"] = cpuRequest
	}
	if memoryRequest != "" {
		requests["memory"] = memoryRequest
	}
	limits := map[string]interface{}{}
	if cpuLimit != "" {
		limits["cpu"] = cpuLimit
	}
	if memoryLimit != "" {
		limits["memory"] = memoryLimit
	}
	if len(requests) == 0 && len(limits) == 0 {
		return nil
	}
	out := map[string]interface{}{}
	if len(requests) > 0 {
		out["requests"] = requests
	}
	if len(limits) > 0 {
		out["limits"] = limits
	}
	return out
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			return trimmed
		}
	}
	return ""
}

func RenderDBExportService(name, namespace, engine string, labels map[string]string) *corev1.Service {
	profile, ok := DBEngineProfileFor(engine)
	if !ok {
		profile = DBEngineProfile{ComponentName: engine, ServicePort: 5432, TargetPortName: engine}
	}
	return &corev1.Service{
		TypeMeta: metav1.TypeMeta{
			APIVersion: "v1",
			Kind:       "Service",
		},
		ObjectMeta: metav1.ObjectMeta{
			Labels:    labels,
			Name:      name + "-export",
			Namespace: namespace,
		},
		Spec: corev1.ServiceSpec{
			Ports: []corev1.ServicePort{
				{Name: "tcp", Port: profile.ServicePort, Protocol: corev1.ProtocolTCP, TargetPort: intstr.FromString(profile.TargetPortName)},
			},
			Selector: map[string]string{
				DBProviderInstanceLabel:             name,
				"apps.kubeblocks.io/component-name": profile.ComponentName,
			},
			Type: corev1.ServiceTypeNodePort,
		},
	}
}
