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
	appListeningPorts := []APAppListeningPort{}
	env := []interface{}{}
	resources := corev1.ResourceRequirements{}
	probes := map[string]interface{}{}
	if len(deployment.Spec.Template.Spec.Containers) > 0 {
		container := deployment.Spec.Template.Spec.Containers[0]
		image = container.Image
		imagePullPolicy = container.ImagePullPolicy
		resources = container.Resources
		if container.StartupProbe != nil {
			probes["startup"] = container.StartupProbe
		}
		if container.LivenessProbe != nil {
			probes["liveness"] = container.LivenessProbe
		}
		if container.ReadinessProbe != nil {
			probes["readiness"] = container.ReadinessProbe
		}
		if len(container.Ports) > 0 {
			privatePort = container.Ports[0].ContainerPort
			appListeningPorts = apAppListeningPortsFromContainerPorts(container.Ports)
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
	if len(appListeningPorts) > 0 {
		network["appListeningPorts"] = APAppListeningPortRows(appListeningPorts)
	}
	if desiredNetwork := desiredAPNetworkFromDeployment(deployment); len(desiredNetwork) > 0 {
		for key, value := range desiredNetwork {
			network[key] = value
		}
		if _, ok := network["privatePort"]; !ok {
			network["privatePort"] = privatePort
		}
		if _, ok := network["appListeningPorts"]; !ok {
			if normalizedPorts, err := NormalizeAPAppListeningPortsFromNetwork(network, privatePort); err == nil {
				network["appListeningPorts"] = APAppListeningPortRows(normalizedPorts)
			}
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

	input := map[string]interface{}{
		"env":             env,
		"image":           image,
		"imagePullPolicy": string(imagePullPolicy),
		"network":         network,
	}
	if envRawSource, ok := deployment.Annotations[APEnvRawSourceAnnotation]; ok && strings.TrimSpace(envRawSource) != "" {
		input["envRawSource"] = envRawSource
	}
	if len(probes) > 0 {
		input["probes"] = probes
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
			"input":    input,
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
	fallbackPort := int32(0)
	if len(deployment.Spec.Template.Spec.Containers) > 0 {
		container := deployment.Spec.Template.Spec.Containers[0]
		if len(container.Ports) > 0 {
			fallbackPort = container.Ports[0].ContainerPort
		}
	}
	appListeningPorts, err := NormalizeAPAppListeningPortsFromNetwork(network, fallbackPort)
	if err != nil || len(appListeningPorts) == 0 {
		return nil
	}
	status := map[string]interface{}{}
	privatePort := appListeningPorts[0].Port
	status["privatePort"] = privatePort
	if address := apPrivateAddress(deployment, privatePort); address != "" {
		status["privateAddress"] = address
	}
	privateRows := make([]interface{}, 0, len(appListeningPorts))
	for _, port := range appListeningPorts {
		row := map[string]interface{}{"port": port.Port}
		if address := apPrivateAddress(deployment, port.Port); address != "" {
			row["privateAddress"] = address
		}
		privateRows = append(privateRows, row)
	}
	status["appListeningPorts"] = privateRows
	publicAddresses := apPublicAddressStatusRows(deployment, network, APAppListeningPortSet(appListeningPorts))
	if len(publicAddresses) > 0 {
		status["publicAddresses"] = publicAddresses
	}
	return status
}

func apPrivateAddress(deployment *appsv1.Deployment, value interface{}) string {
	privatePort, ok := int32FromInterface(value)
	if deployment == nil || !ok || privatePort <= 0 || deployment.Namespace == "" || deployment.Name == "" {
		return ""
	}
	serviceName := APServiceName(deployment.Name)
	if privatePort == 80 {
		return fmt.Sprintf("http://%s.%s.svc.cluster.local", serviceName, deployment.Namespace)
	}
	return fmt.Sprintf("http://%s.%s.svc.cluster.local:%d", serviceName, deployment.Namespace, privatePort)
}

func int32FromInterface(value interface{}) (int32, bool) {
	return APPortFromInterface(value)
}

func apAppListeningPortsFromContainerPorts(ports []corev1.ContainerPort) []APAppListeningPort {
	out := make([]APAppListeningPort, 0, len(ports))
	seen := make(map[int32]bool, len(ports))
	for _, port := range ports {
		if !IsValidAPPort(port.ContainerPort) || seen[port.ContainerPort] {
			continue
		}
		seen[port.ContainerPort] = true
		out = append(out, APAppListeningPort{Port: port.ContainerPort})
	}
	return out
}

func apPublicAddressStatusRows(deployment *appsv1.Deployment, network map[string]interface{}, appListeningPortSet map[int32]bool) []interface{} {
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
	for _, row := range apCustomDomainRows(network["customDomains"], platformsByID, appListeningPortSet) {
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
		domainPrefix, _ := row["domainPrefix"].(string)
		host := PlatformAddressHost(deployment.Namespace, deployment.Name, id, domainPrefix, deployment.Labels[APRoutingDomainLabel])
		if host != "" {
			row["host"] = host
			row["url"] = fmt.Sprintf("https://%s/", host)
		}
		if apPublicAddressTargetPortMissing(row, appListeningPortSet) {
			row["reason"] = "target-port-missing"
			row["status"] = "blocked"
		} else {
			row["status"] = "progressing"
		}
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
		outRow := map[string]interface{}{
			"id":   id,
			"port": row["port"],
		}
		if domainPrefix, ok := row["domainPrefix"].(string); ok && strings.TrimSpace(domainPrefix) != "" {
			outRow["domainPrefix"] = strings.TrimSpace(domainPrefix)
		}
		out = append(out, outRow)
	}
	return out
}

func apCustomDomainRows(value interface{}, platformsByID map[string]map[string]interface{}, appListeningPortSet map[int32]bool) []map[string]interface{} {
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
		outRow := map[string]interface{}{
			"host":              domain,
			"id":                id,
			"platformAddressId": platformID,
			"port":              platform["port"],
			"type":              "custom",
			"url":               fmt.Sprintf("https://%s/", domain),
		}
		if apPublicAddressTargetPortMissing(outRow, appListeningPortSet) {
			outRow["reason"] = "target-port-missing"
			outRow["status"] = "blocked"
		} else {
			outRow["status"] = "pending"
		}
		out = append(out, outRow)
	}
	return out
}

func apPublicAddressTargetPortMissing(row map[string]interface{}, appListeningPortSet map[int32]bool) bool {
	if len(appListeningPortSet) == 0 {
		return false
	}
	port, ok := APPortFromInterface(row["port"])
	return !ok || !appListeningPortSet[port]
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
