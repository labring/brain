package ap

import (
	"encoding/json"
	"strings"

	orchestration "sealos/api/service/orchestration"
)

func apReplicasFromResourceSpec(resourceSpec map[string]interface{}) int32 {
	if resourceSpec == nil {
		return 0
	}
	if replicas := int32FromMap(resourceSpec, "replicas"); replicas > 0 {
		return replicas
	}
	replicaStrategy, _ := resourceSpec["replicaStrategy"].(map[string]interface{})
	if replicaStrategy == nil {
		return 0
	}
	if strategyType := stringFromMap(replicaStrategy, "type"); strategyType != "" && strategyType != "fixed" {
		return 0
	}
	fixed, _ := replicaStrategy["fixed"].(map[string]interface{})
	return int32FromMap(fixed, "replicas")
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
