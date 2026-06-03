package orchestration

import (
	"strings"

	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
)

func DBObjectFromCluster(cluster *unstructured.Unstructured) map[string]interface{} {
	if cluster == nil {
		return nil
	}
	labels := map[string]interface{}{}
	for key, value := range cluster.GetLabels() {
		labels[key] = value
	}
	engine := strings.TrimSpace(cluster.GetLabels()[BrainDBEngineLabel])
	if engine == "" {
		engine = strings.TrimSpace(cluster.GetLabels()[DBProviderClusterDefinitionLabel])
	}
	spec := cluster.Object["spec"]
	statusRaw, _ := cluster.Object["status"].(map[string]interface{})
	phase := dbPhase(statusRaw)
	return map[string]interface{}{
		"apiVersion": "brain.io/direct",
		"kind":       "DB",
		"metadata": map[string]interface{}{
			"creationTimestamp": cluster.GetCreationTimestamp().String(),
			"labels":            labels,
			"name":              cluster.GetName(),
			"namespace":         cluster.GetNamespace(),
			"uid":               string(cluster.GetUID()),
		},
		"spec": map[string]interface{}{
			"engine": engine,
			"name":   cluster.GetName(),
			"raw":    spec,
		},
		"status": map[string]interface{}{
			"observed": statusRaw,
			"phase":    phase,
		},
	}
}

func dbPhase(status map[string]interface{}) string {
	if status == nil {
		return "Creating"
	}
	phase, _ := status["phase"].(string)
	phase = strings.TrimSpace(phase)
	if phase != "" {
		return phase
	}
	conditions, _ := status["conditions"].([]interface{})
	for _, item := range conditions {
		condition, _ := item.(map[string]interface{})
		if condition == nil {
			continue
		}
		if condition["type"] == "Ready" && condition["status"] == "True" {
			return "Running"
		}
	}
	return "Creating"
}
