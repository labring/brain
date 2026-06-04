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

func RenderDBRestartOpsRequest(name, namespace, engine string, now time.Time) (*unstructured.Unstructured, error) {
	name = strings.TrimSpace(name)
	namespace = strings.TrimSpace(namespace)
	if name == "" || namespace == "" {
		return nil, fmt.Errorf("name and namespace are required")
	}
	profile, ok := DBEngineProfileFor(engine)
	if !ok {
		return nil, fmt.Errorf("unsupported DB engine %q", engine)
	}
	suffix := now.UTC().Format("20060102150405")
	return &unstructured.Unstructured{
		Object: map[string]interface{}{
			"apiVersion": "apps.kubeblocks.io/v1alpha1",
			"kind":       "OpsRequest",
			"metadata": map[string]interface{}{
				"labels": map[string]interface{}{
					DBProviderCRLabel:       name,
					DBProviderInstanceLabel: name,
				},
				"name":      name + "-restart-" + suffix,
				"namespace": namespace,
			},
			"spec": map[string]interface{}{
				"clusterName": name,
				"restart": []interface{}{
					map[string]interface{}{"componentName": profile.ComponentName},
				},
				"type": "Restart",
			},
		},
	}, nil
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
