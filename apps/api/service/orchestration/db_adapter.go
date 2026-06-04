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
	component := dbPrimaryComponent(cluster, engine)
	productSpec := map[string]interface{}{
		"engine": engine,
		"name":   cluster.GetName(),
		"raw":    spec,
	}
	if replicas, found := int64FromNested(component, "replicas"); found && replicas > 0 {
		productSpec["replicas"] = replicas
	}
	if cpuLimit, found := stringFromNested(component, "resources", "limits", "cpu"); found {
		productSpec["cpuLimit"] = cpuLimit
	}
	if memoryLimit, found := stringFromNested(component, "resources", "limits", "memory"); found {
		productSpec["memoryLimit"] = memoryLimit
	}
	if storageSize, found := dbComponentStorageSize(component); found {
		productSpec["storageSize"] = storageSize
	}
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
		"spec": productSpec,
		"status": map[string]interface{}{
			"observed": statusRaw,
			"phase":    phase,
		},
	}
}

func dbPrimaryComponent(cluster *unstructured.Unstructured, engine string) map[string]interface{} {
	components, found, _ := unstructured.NestedSlice(cluster.Object, "spec", "componentSpecs")
	if !found || len(components) == 0 {
		return nil
	}
	if profile, ok := DBEngineProfileFor(engine); ok {
		for _, item := range components {
			component, _ := item.(map[string]interface{})
			if component == nil {
				continue
			}
			if name, _ := component["name"].(string); name == profile.ComponentName {
				return component
			}
			if name, _ := component["componentDefRef"].(string); name == profile.ComponentName {
				return component
			}
		}
	}
	component, _ := components[0].(map[string]interface{})
	return component
}

func dbComponentStorageSize(component map[string]interface{}) (string, bool) {
	templates, found, _ := unstructured.NestedSlice(component, "volumeClaimTemplates")
	if !found || len(templates) == 0 {
		return "", false
	}
	template, _ := templates[0].(map[string]interface{})
	return stringFromNested(template, "spec", "resources", "requests", "storage")
}

func stringFromNested(values map[string]interface{}, fields ...string) (string, bool) {
	value, found, _ := unstructured.NestedString(values, fields...)
	value = strings.TrimSpace(value)
	return value, found && value != ""
}

func int64FromNested(values map[string]interface{}, fields ...string) (int64, bool) {
	value, found, _ := unstructured.NestedInt64(values, fields...)
	if found {
		return value, true
	}
	raw, found, _ := unstructured.NestedFieldNoCopy(values, fields...)
	if !found {
		return 0, false
	}
	switch typed := raw.(type) {
	case int:
		return int64(typed), true
	case int32:
		return int64(typed), true
	case int64:
		return typed, true
	case float64:
		rounded := int64(typed)
		return rounded, typed == float64(rounded)
	default:
		return 0, false
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
