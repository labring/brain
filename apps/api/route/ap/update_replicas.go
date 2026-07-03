package ap

import (
	"encoding/json"
	"strings"

	orchestration "sealos/api/service/orchestration"
)

// Legacy spec.resource.replicas is only a fallback when replicaStrategy is
// absent or carries no usable fixed count: settings clients replace the whole
// spec.resource subtree, so their patches echo the previously rendered legacy
// value next to the replicaStrategy they actually changed.
func apReplicasFromResourceSpec(resourceSpec map[string]interface{}) int32 {
	if resourceSpec == nil {
		return 0
	}
	legacyReplicas := int32FromMap(resourceSpec, "replicas")
	replicaStrategy, _ := resourceSpec["replicaStrategy"].(map[string]interface{})
	if replicaStrategy == nil {
		return legacyReplicas
	}
	if strategyType := stringFromMap(replicaStrategy, "type"); strategyType != "" && strategyType != "fixed" {
		return 0
	}
	fixed, _ := replicaStrategy["fixed"].(map[string]interface{})
	if fixedReplicas := int32FromMap(fixed, "replicas"); fixedReplicas > 0 {
		return fixedReplicas
	}
	return legacyReplicas
}

func apReplicaStrategyFromAnnotation(raw string, fallbackReplicas int32) *orchestration.APReplicaStrategy {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil
	}
	var strategy map[string]interface{}
	if err := json.Unmarshal([]byte(raw), &strategy); err != nil {
		return nil
	}
	return apReplicaStrategyFromMap(strategy, fallbackReplicas)
}

func apReplicaStrategyFromResourceSpec(resourceSpec map[string]interface{}) *orchestration.APReplicaStrategy {
	if resourceSpec == nil {
		return nil
	}
	fallbackReplicas := apReplicasFromResourceSpec(resourceSpec)
	replicaStrategy, _ := resourceSpec["replicaStrategy"].(map[string]interface{})
	if replicaStrategy == nil {
		if fallbackReplicas > 0 {
			return &orchestration.APReplicaStrategy{
				Fixed: orchestration.APFixedReplicaSettings{Replicas: fallbackReplicas},
				Type:  "fixed",
			}
		}
		return nil
	}
	return apReplicaStrategyFromMap(replicaStrategy, fallbackReplicas)
}

func apReplicaStrategyFromMap(value map[string]interface{}, fallbackReplicas int32) *orchestration.APReplicaStrategy {
	if value == nil {
		return nil
	}
	fixed, _ := value["fixed"].(map[string]interface{})
	fixedReplicas := int32FromMap(fixed, "replicas")
	if fixedReplicas < 1 {
		fixedReplicas = fallbackReplicas
	}
	if fixedReplicas < 1 {
		fixedReplicas = 1
	}
	out := &orchestration.APReplicaStrategy{
		Fixed: orchestration.APFixedReplicaSettings{Replicas: fixedReplicas},
		Type:  "fixed",
	}
	if stringFromMap(value, "type") != "elastic" {
		return out
	}
	elastic, _ := value["elastic"].(map[string]interface{})
	if elastic == nil {
		return out
	}
	targetMap, _ := elastic["target"].(map[string]interface{})
	target := orchestration.APElasticReplicaTarget{
		Metric:             stringFromMap(targetMap, "metric"),
		Type:               stringFromMap(targetMap, "type"),
		AverageValue:       stringFromMap(targetMap, "averageValue"),
		UtilizationPercent: int32FromMap(targetMap, "utilizationPercent"),
	}
	out.Type = "elastic"
	out.Elastic = &orchestration.APElasticReplicaSettings{
		MaxReplicas: int32FromMap(elastic, "maxReplicas"),
		MinReplicas: int32FromMap(elastic, "minReplicas"),
		Target:      target,
	}
	return out
}
