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
	Name           string
	Namespace      string
	ProjectID      string
	Replicas       int64
	StorageSize    string
}

func RenderDBRestartOpsRequest(name, namespace string, now time.Time) (*unstructured.Unstructured, error) {
	name = strings.TrimSpace(name)
	namespace = strings.TrimSpace(namespace)
	if name == "" || namespace == "" {
		return nil, fmt.Errorf("name and namespace are required")
	}
	suffix := now.UTC().Format("20060102150405")
	return &unstructured.Unstructured{
		Object: map[string]interface{}{
			"apiVersion": "apps.kubeblocks.io/v1",
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
				"type":        "Restart",
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
	version := strings.TrimSpace(input.ClusterVersion)
	if version == "" {
		version = engine
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
			DBProviderClusterDefinitionLabel: engine,
			DBProviderClusterVersionLabel:    version,
			DBProviderCRLabel:                name,
			DBProviderInstanceLabel:          name,
		},
	)
	cluster := &unstructured.Unstructured{
		Object: map[string]interface{}{
			"apiVersion": "apps.kubeblocks.io/v1",
			"kind":       "Cluster",
			"metadata": map[string]interface{}{
				"name":      name,
				"namespace": namespace,
			},
			"spec": map[string]interface{}{
				"clusterDefinitionRef": engine,
				"clusterVersionRef":    version,
				"componentSpecs": []interface{}{
					map[string]interface{}{
						"componentDefRef": engine,
						"name":            engine,
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
		Version: "v1",
		Kind:    "Cluster",
	})
	cluster.SetLabels(labels)

	exportService := &corev1.Service{
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
				{Name: "tcp", Port: 5432, Protocol: corev1.ProtocolTCP, TargetPort: intstr.FromString(engine)},
			},
			Selector: map[string]string{
				DBProviderInstanceLabel:             name,
				"apps.kubeblocks.io/component-name": engine,
			},
			Type: corev1.ServiceTypeNodePort,
		},
	}

	return &DBResources{Cluster: cluster, ExportService: exportService}, nil
}
