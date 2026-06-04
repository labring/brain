package orchestration

import (
	"encoding/json"
	"fmt"
	"strings"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
)

func APObjectFromDeployment(deployment *appsv1.Deployment) map[string]interface{} {
	if deployment == nil {
		return nil
	}
	labels := map[string]interface{}{}
	for key, value := range deployment.Labels {
		labels[key] = value
	}
	annotations := map[string]interface{}{}
	for key, value := range deployment.Annotations {
		annotations[key] = value
	}
	image := ""
	imagePullPolicy := corev1.PullAlways
	privatePort := int32(0)
	env := []interface{}{}
	resources := corev1.ResourceRequirements{}
	if len(deployment.Spec.Template.Spec.Containers) > 0 {
		container := deployment.Spec.Template.Spec.Containers[0]
		image = container.Image
		imagePullPolicy = container.ImagePullPolicy
		resources = container.Resources
		if len(container.Ports) > 0 {
			privatePort = container.Ports[0].ContainerPort
		}
		for _, item := range container.Env {
			row := map[string]interface{}{"name": item.Name}
			if item.Value != "" {
				row["value"] = item.Value
			}
			if item.ValueFrom != nil {
				row["valueFrom"] = item.ValueFrom
			}
			env = append(env, row)
		}
	}
	replicas := int32(1)
	if deployment.Spec.Replicas != nil {
		replicas = *deployment.Spec.Replicas
	}
	replicaStrategy := apReplicaStrategyFromDeployment(deployment, replicas)
	phase := deploymentPhase(deployment)
	network := map[string]interface{}{
		"privatePort": privatePort,
	}
	if desiredNetwork := desiredAPNetworkFromDeployment(deployment); len(desiredNetwork) > 0 {
		for key, value := range desiredNetwork {
			network[key] = value
		}
		if _, ok := network["privatePort"]; !ok {
			network["privatePort"] = privatePort
		}
	}
	status := map[string]interface{}{
		"availableReplicas": deployment.Status.AvailableReplicas,
		"phase":             phase,
		"readyReplicas":     deployment.Status.ReadyReplicas,
		"replicas":          deployment.Status.Replicas,
	}
	if networkStatus := apNetworkStatusFromDesiredNetwork(deployment, network); len(networkStatus) > 0 {
		status["network"] = networkStatus
	}

	return map[string]interface{}{
		"apiVersion": "brain.io/direct",
		"kind":       "AP",
		"metadata": map[string]interface{}{
			"annotations":       annotations,
			"creationTimestamp": deployment.CreationTimestamp.String(),
			"labels":            labels,
			"name":              deployment.Name,
			"namespace":         deployment.Namespace,
			"uid":               string(deployment.UID),
		},
		"spec": map[string]interface{}{
			"input": map[string]interface{}{
				"env":             env,
				"image":           image,
				"imagePullPolicy": string(imagePullPolicy),
				"network":         network,
			},
			"name":     deployment.Name,
			"resource": apResourceFromDeployment(resources, replicaStrategy, replicas),
			"paused":   strings.EqualFold(deployment.Annotations[LaunchpadPauseAnnotation], "true"),
		},
		"status": status,
	}
}

func apResourceFromDeployment(resources corev1.ResourceRequirements, replicaStrategy map[string]interface{}, replicas int32) map[string]interface{} {
	out := map[string]interface{}{
		"replicaStrategy": replicaStrategy,
		"replicas":        replicas,
	}
	if len(resources.Limits) > 0 {
		limits := map[string]interface{}{}
		for key, value := range resources.Limits {
			limits[string(key)] = value.String()
		}
		out["limits"] = limits
	}
	if len(resources.Requests) > 0 {
		requests := map[string]interface{}{}
		for key, value := range resources.Requests {
			requests[string(key)] = value.String()
		}
		out["requests"] = requests
	}
	return out
}

func apReplicaStrategyFromDeployment(deployment *appsv1.Deployment, replicas int32) map[string]interface{} {
	fallback := map[string]interface{}{
		"fixed": map[string]interface{}{
			"replicas": replicas,
		},
		"type": "fixed",
	}
	raw := strings.TrimSpace(deployment.Annotations[APReplicaStrategyAnnotation])
	if raw == "" {
		return fallback
	}
	var strategy map[string]interface{}
	if err := json.Unmarshal([]byte(raw), &strategy); err != nil {
		return fallback
	}
	if _, ok := strategy["fixed"].(map[string]interface{}); !ok {
		strategy["fixed"] = map[string]interface{}{"replicas": replicas}
	}
	if strategy["type"] != "elastic" {
		strategy["type"] = "fixed"
	}
	return strategy
}

func desiredAPNetworkFromDeployment(deployment *appsv1.Deployment) map[string]interface{} {
	raw := strings.TrimSpace(deployment.Annotations[APDesiredNetworkAnnotation])
	if raw == "" {
		return nil
	}
	var network map[string]interface{}
	if err := json.Unmarshal([]byte(raw), &network); err != nil {
		return nil
	}
	return network
}

func apNetworkStatusFromDesiredNetwork(deployment *appsv1.Deployment, network map[string]interface{}) map[string]interface{} {
	if len(network) == 0 {
		return nil
	}
	status := map[string]interface{}{}
	if privatePort, ok := network["privatePort"]; ok {
		status["privatePort"] = privatePort
	}
	publicAddresses := apPublicAddressStatusRows(deployment, network)
	if len(publicAddresses) > 0 {
		status["publicAddresses"] = publicAddresses
	}
	return status
}

func apPublicAddressStatusRows(deployment *appsv1.Deployment, network map[string]interface{}) []interface{} {
	platformRows := apPlatformAddressRows(network["platformAddresses"])
	if len(platformRows) == 0 {
		return nil
	}
	platformsByID := make(map[string]map[string]interface{}, len(platformRows))
	for _, row := range platformRows {
		id, _ := row["id"].(string)
		if id != "" {
			platformsByID[id] = row
		}
	}

	promotedPlatformIDs := map[string]bool{}
	out := []interface{}{}
	for _, row := range apCustomDomainRows(network["customDomains"], platformsByID) {
		platformID, _ := row["platformAddressId"].(string)
		if platformID != "" {
			promotedPlatformIDs[platformID] = true
		}
		out = append(out, row)
	}
	for _, row := range platformRows {
		id, _ := row["id"].(string)
		if promotedPlatformIDs[id] {
			continue
		}
		host := PlatformAddressHost(deployment.Namespace, deployment.Name, id, deployment.Labels[APRoutingDomainLabel])
		if host != "" {
			row["host"] = host
			row["url"] = fmt.Sprintf("https://%s/", host)
		}
		row["status"] = "progressing"
		row["type"] = "platform"
		out = append(out, row)
	}
	return out
}

func apPlatformAddressRows(value interface{}) []map[string]interface{} {
	rows, ok := value.([]interface{})
	if !ok || len(rows) == 0 {
		return nil
	}
	out := make([]map[string]interface{}, 0, len(rows))
	for _, item := range rows {
		row, _ := item.(map[string]interface{})
		if row == nil {
			continue
		}
		id, _ := row["id"].(string)
		id = strings.TrimSpace(id)
		if id == "" {
			continue
		}
		out = append(out, map[string]interface{}{
			"id":   id,
			"port": row["port"],
		})
	}
	return out
}

func apCustomDomainRows(value interface{}, platformsByID map[string]map[string]interface{}) []map[string]interface{} {
	rows, ok := value.([]interface{})
	if !ok || len(rows) == 0 {
		return nil
	}
	out := make([]map[string]interface{}, 0, len(rows))
	for _, item := range rows {
		row, _ := item.(map[string]interface{})
		if row == nil {
			continue
		}
		id, _ := row["id"].(string)
		domain, _ := row["domain"].(string)
		platformID, _ := row["platformAddressId"].(string)
		id = strings.TrimSpace(id)
		domain = strings.Trim(strings.ToLower(strings.TrimSpace(domain)), ".")
		platformID = strings.TrimSpace(platformID)
		platform := platformsByID[platformID]
		if id == "" || domain == "" || platform == nil {
			continue
		}
		out = append(out, map[string]interface{}{
			"host":              domain,
			"id":                id,
			"platformAddressId": platformID,
			"port":              platform["port"],
			"status":            "pending",
			"type":              "custom",
			"url":               fmt.Sprintf("https://%s/", domain),
		})
	}
	return out
}

func deploymentPhase(deployment *appsv1.Deployment) string {
	if deployment.Annotations[LaunchpadPauseAnnotation] == "true" {
		return "Paused"
	}
	if deployment.Status.UnavailableReplicas > 0 {
		return "Updating"
	}
	if deployment.Status.ReadyReplicas > 0 && deployment.Status.ReadyReplicas == deployment.Status.Replicas {
		return "Running"
	}
	if deployment.Generation > deployment.Status.ObservedGeneration {
		return "Updating"
	}
	return "Creating"
}
