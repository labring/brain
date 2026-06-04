package orchestration

import (
	"fmt"
	"strings"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/util/intstr"
)

type DBResourcesInput struct {
	ClusterVersion string
	Engine         string
	ExposeNodePort bool
	Name           string
	Namespace      string
	ProjectID      string
	Replicas       int64
	StorageSize    string
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
	Cluster       *unstructured.Unstructured
	ExportService *corev1.Service
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
		storageSize = "10Gi"
	}
	labels := mergeStringMap(
		brainLabels(projectID, ResourceKindDB, name),
		map[string]string{
			BrainDBEngineLabel:               engine,
			BrainDBNameLabel:                 name,
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
				"componentSpecs": []interface{}{
					map[string]interface{}{
						"componentDefRef": profile.ComponentName,
						"name":            profile.ComponentName,
						"replicas":        replicas,
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
					},
				},
				"terminationPolicy": "Delete",
			},
		},
	}
	cluster.SetGroupVersionKind(schema.GroupVersionKind{
		Group:   "apps.kubeblocks.io",
		Version: "v1alpha1",
		Kind:    "Cluster",
	})
	cluster.SetLabels(labels)

	var exportService *corev1.Service
	if input.ExposeNodePort {
		exportService = RenderDBExportService(name, namespace, engine, labels)
	}

	return &DBResources{Cluster: cluster, ExportService: exportService}, nil
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
