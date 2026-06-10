package orchestration

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
)

func APObjectFromDeployment(deployment *appsv1.Deployment) map[string]interface{} {
	if deployment == nil {
		return nil
	}
	return apObjectFromWorkload(apWorkloadView{
		Annotations:         deployment.Annotations,
		AvailableReplicas:   deployment.Status.AvailableReplicas,
		Containers:          deployment.Spec.Template.Spec.Containers,
		CreationTimestamp:   deployment.CreationTimestamp.String(),
		Generation:          deployment.Generation,
		ImagePullSecrets:    deployment.Spec.Template.Spec.ImagePullSecrets,
		Kind:                APWorkloadKindDeployment,
		Labels:              deployment.Labels,
		Name:                deployment.Name,
		Namespace:           deployment.Namespace,
		ObservedGeneration:  deployment.Status.ObservedGeneration,
		Paused:              strings.EqualFold(deployment.Annotations[LaunchpadPauseAnnotation], "true"),
		PodAnnotations:      deployment.Spec.Template.Annotations,
		ProjectID:           deployment.Labels[BrainProjectIDLabel],
		ReadyReplicas:       deployment.Status.ReadyReplicas,
		Replicas:            deploymentReplicas(deployment),
		StatusReplicas:      deployment.Status.Replicas,
		UnavailableReplicas: deployment.Status.UnavailableReplicas,
		UID:                 string(deployment.UID),
		Volumes:             deployment.Spec.Template.Spec.Volumes,
	})
}

func APObjectFromStatefulSet(statefulSet *appsv1.StatefulSet) map[string]interface{} {
	if statefulSet == nil {
		return nil
	}
	return apObjectFromWorkload(apWorkloadView{
		Annotations:           statefulSet.Annotations,
		AvailableReplicas:     statefulSet.Status.AvailableReplicas,
		Containers:            statefulSet.Spec.Template.Spec.Containers,
		CreationTimestamp:     statefulSet.CreationTimestamp.String(),
		Generation:            statefulSet.Generation,
		ImagePullSecrets:      statefulSet.Spec.Template.Spec.ImagePullSecrets,
		Kind:                  APWorkloadKindStatefulSet,
		Labels:                statefulSet.Labels,
		Name:                  statefulSet.Name,
		Namespace:             statefulSet.Namespace,
		ObservedGeneration:    statefulSet.Status.ObservedGeneration,
		Paused:                strings.EqualFold(statefulSet.Annotations[LaunchpadPauseAnnotation], "true"),
		PodAnnotations:        statefulSet.Spec.Template.Annotations,
		ProjectID:             statefulSet.Labels[BrainProjectIDLabel],
		ReadyReplicas:         statefulSet.Status.ReadyReplicas,
		Replicas:              statefulSetReplicas(statefulSet),
		StatusReplicas:        statefulSet.Status.Replicas,
		StorageClaimTemplates: statefulSet.Spec.VolumeClaimTemplates,
		UID:                   string(statefulSet.UID),
		Volumes:               statefulSet.Spec.Template.Spec.Volumes,
	})
}

type apWorkloadView struct {
	Annotations           map[string]string
	AvailableReplicas     int32
	Containers            []corev1.Container
	CreationTimestamp     string
	Generation            int64
	ImagePullSecrets      []corev1.LocalObjectReference
	Kind                  APWorkloadKind
	Labels                map[string]string
	Name                  string
	Namespace             string
	ObservedGeneration    int64
	Paused                bool
	PodAnnotations        map[string]string
	ProjectID             string
	ReadyReplicas         int32
	Replicas              int32
	StatusReplicas        int32
	StorageClaimTemplates []corev1.PersistentVolumeClaim
	UID                   string
	UnavailableReplicas   int32
	Volumes               []corev1.Volume
}

func apObjectFromWorkload(workload apWorkloadView) map[string]interface{} {
	labels := map[string]interface{}{}
	for key, value := range workload.Labels {
		labels[key] = value
	}
	annotations := map[string]interface{}{}
	for key, value := range workload.Annotations {
		annotations[key] = value
	}
	image := ""
	imagePullPolicy := corev1.PullAlways
	privatePort := int32(0)
	appListeningPorts := []APAppListeningPort{}
	env := []interface{}{}
	resources := corev1.ResourceRequirements{}
	probes := map[string]interface{}{}
	var command []string
	var args []string
	configMaps := []interface{}{}
	if len(workload.Containers) > 0 {
		container := workload.Containers[0]
		args = container.Args
		command = container.Command
		configMaps = apConfigMapsFromPod(workload.Name, container, workload.Volumes)
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
	replicaStrategy := apReplicaStrategyFromWorkload(workload.Annotations, workload.Replicas)
	phase := apWorkloadPhase(workload)
	network := map[string]interface{}{
		"privatePort": privatePort,
	}
	if len(appListeningPorts) > 0 {
		network["appListeningPorts"] = APAppListeningPortRows(appListeningPorts)
	}
	if desiredNetwork := desiredAPNetworkFromAnnotations(workload.Annotations); len(desiredNetwork) > 0 {
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
		"availableReplicas": workload.AvailableReplicas,
		"phase":             phase,
		"readyReplicas":     workload.ReadyReplicas,
		"replicas":          workload.StatusReplicas,
	}
	if networkStatus := apNetworkStatusFromDesiredNetwork(workload.Name, workload.Namespace, workload.Labels, workload.Containers, network); len(networkStatus) > 0 {
		status["network"] = networkStatus
	}
	if configHash := strings.TrimSpace(workload.PodAnnotations[APConfigMapChecksumAnnotation]); configHash != "" {
		status["configVersionHash"] = configHash
	}

	input := map[string]interface{}{
		"env":             env,
		"image":           image,
		"imagePullPolicy": string(imagePullPolicy),
		"network":         network,
	}
	if len(command) > 0 {
		input["command"] = command
	}
	if len(args) > 0 {
		input["args"] = args
	}
	if len(configMaps) > 0 {
		input["configMaps"] = configMaps
	}
	if storage := apDesiredStorageFromAnnotations(workload.Annotations); len(storage) > 0 {
		input["storage"] = storage
	} else if storage := apStorageFromClaims(workload.StorageClaimTemplates); len(storage) > 0 {
		input["storage"] = storage
	}
	if len(probes) > 0 {
		input["probes"] = probes
	}
	if imagePullSecrets := apImagePullSecretsFromPodSpec(workload.ImagePullSecrets); len(imagePullSecrets) > 0 {
		input["imagePullSecrets"] = imagePullSecrets
	}

	spec := map[string]interface{}{
		"input":     input,
		"name":      workload.Name,
		"paused":    workload.Paused,
		"projectId": workload.ProjectID,
		"resource":  apResourceFromDeployment(resources, replicaStrategy, workload.Replicas),
		"workload": map[string]interface{}{
			"kind": APWorkloadKindString(workload.Kind),
		},
	}
	if restartRequest, ok := apRestartRequestFromAnnotations(workload.Annotations); ok {
		spec["restartRequest"] = restartRequest
	}

	return map[string]interface{}{
		"apiVersion": "brain.io/direct",
		"kind":       "AP",
		"metadata": map[string]interface{}{
			"annotations":       annotations,
			"creationTimestamp": workload.CreationTimestamp,
			"labels":            labels,
			"name":              workload.Name,
			"namespace":         workload.Namespace,
			"uid":               workload.UID,
		},
		"spec":   spec,
		"status": status,
	}
}

func apImagePullSecretsFromPodSpec(items []corev1.LocalObjectReference) []interface{} {
	out := make([]interface{}, 0, len(items))
	seen := map[string]bool{}
	for _, item := range items {
		name := strings.TrimSpace(item.Name)
		if name == "" || seen[name] {
			continue
		}
		seen[name] = true
		out = append(out, map[string]interface{}{"name": name})
	}
	return out
}

func apRestartRequestFromAnnotations(annotations map[string]string) (int64, bool) {
	raw := strings.TrimSpace(annotations[APRestartRequestAnnotation])
	if raw == "" {
		return 0, false
	}
	value, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || value < 0 {
		return 0, false
	}
	return value, true
}

func deploymentReplicas(deployment *appsv1.Deployment) int32 {
	if deployment == nil || deployment.Spec.Replicas == nil {
		return 1
	}
	return *deployment.Spec.Replicas
}

func statefulSetReplicas(statefulSet *appsv1.StatefulSet) int32 {
	if statefulSet == nil || statefulSet.Spec.Replicas == nil {
		return 1
	}
	return *statefulSet.Spec.Replicas
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
	if deployment == nil {
		return apReplicaStrategyFromWorkload(nil, replicas)
	}
	return apReplicaStrategyFromWorkload(deployment.Annotations, replicas)
}

func apReplicaStrategyFromWorkload(annotations map[string]string, replicas int32) map[string]interface{} {
	fallback := map[string]interface{}{
		"fixed": map[string]interface{}{
			"replicas": replicas,
		},
		"type": "fixed",
	}
	raw := strings.TrimSpace(annotations[APReplicaStrategyAnnotation])
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
	if deployment == nil {
		return nil
	}
	return desiredAPNetworkFromAnnotations(deployment.Annotations)
}

func desiredAPNetworkFromStatefulSet(statefulSet *appsv1.StatefulSet) map[string]interface{} {
	if statefulSet == nil {
		return nil
	}
	return desiredAPNetworkFromAnnotations(statefulSet.Annotations)
}

func desiredAPNetworkFromAnnotations(annotations map[string]string) map[string]interface{} {
	raw := strings.TrimSpace(annotations[APDesiredNetworkAnnotation])
	if raw == "" {
		return nil
	}
	var network map[string]interface{}
	if err := json.Unmarshal([]byte(raw), &network); err != nil {
		return nil
	}
	return network
}

func apNetworkStatusFromDesiredNetwork(name, namespace string, labels map[string]string, containers []corev1.Container, network map[string]interface{}) map[string]interface{} {
	if len(network) == 0 {
		return nil
	}
	fallbackPort := int32(0)
	if len(containers) > 0 {
		container := containers[0]
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
	if address := apPrivateAddress(name, namespace, privatePort); address != "" {
		status["privateAddress"] = address
	}
	privateRows := make([]interface{}, 0, len(appListeningPorts))
	for _, port := range appListeningPorts {
		row := map[string]interface{}{"port": port.Port}
		if address := apPrivateAddress(name, namespace, port.Port); address != "" {
			row["privateAddress"] = address
		}
		privateRows = append(privateRows, row)
	}
	status["appListeningPorts"] = privateRows
	publicAddresses := apPublicAddressStatusRows(name, namespace, labels, network, APAppListeningPortSet(appListeningPorts))
	if len(publicAddresses) > 0 {
		status["publicAddresses"] = publicAddresses
	}
	return status
}

func apPrivateAddress(name, namespace string, value interface{}) string {
	privatePort, ok := int32FromInterface(value)
	if !ok || privatePort <= 0 || namespace == "" || name == "" {
		return ""
	}
	serviceName := APServiceName(name)
	if privatePort == 80 {
		return fmt.Sprintf("http://%s.%s.svc.cluster.local", serviceName, namespace)
	}
	return fmt.Sprintf("http://%s.%s.svc.cluster.local:%d", serviceName, namespace, privatePort)
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

func apPublicAddressStatusRows(name, namespace string, labels map[string]string, network map[string]interface{}, appListeningPortSet map[int32]bool) []interface{} {
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
		host := PlatformAddressHost(namespace, name, id, domainPrefix, labels[APRoutingDomainLabel])
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

func apConfigMapsFromPod(apName string, container corev1.Container, volumes []corev1.Volume) []interface{} {
	volumeName := APConfigMapVolumeName(apName)
	configMapNamesByVolume := map[string]string{}
	for _, volume := range volumes {
		if volume.ConfigMap == nil || strings.TrimSpace(volume.ConfigMap.Name) == "" {
			continue
		}
		configMapNamesByVolume[volume.Name] = strings.TrimSpace(volume.ConfigMap.Name)
	}
	out := []interface{}{}
	for _, mount := range container.VolumeMounts {
		configMapName := configMapNamesByVolume[mount.Name]
		if configMapName == "" && mount.Name == volumeName {
			configMapName = APConfigMapName(apName)
		}
		if configMapName == "" || mount.SubPath == "" || mount.MountPath == "" {
			continue
		}
		out = append(out, map[string]interface{}{
			"key":  mount.SubPath,
			"name": configMapName,
			"path": mount.MountPath,
		})
	}
	return out
}

func apStorageFromClaims(claims []corev1.PersistentVolumeClaim) []interface{} {
	out := []interface{}{}
	for _, claim := range claims {
		path := strings.TrimSpace(claim.Annotations[APStorageMountPathAnnotation])
		if path == "" {
			path = strings.TrimSpace(claim.Annotations["path"])
		}
		if path == "" {
			continue
		}
		size := strings.TrimSpace(claim.Annotations[APStorageSizeAnnotation])
		if size == "" && claim.Spec.Resources.Requests != nil {
			size = claim.Spec.Resources.Requests.Storage().String()
		}
		row := map[string]interface{}{
			"name": claim.Name,
			"path": path,
		}
		if size != "" {
			row["size"] = size
		}
		out = append(out, row)
	}
	return out
}

func apDesiredStorageFromAnnotations(annotations map[string]string) []interface{} {
	raw := strings.TrimSpace(annotations[APDesiredStorageAnnotation])
	if raw == "" {
		return nil
	}
	var items []APStorageMount
	if err := json.Unmarshal([]byte(raw), &items); err != nil {
		return nil
	}
	out := make([]interface{}, 0, len(items))
	for _, item := range items {
		path := strings.TrimSpace(item.Path)
		if path == "" {
			continue
		}
		row := map[string]interface{}{"path": path, "name": APStorageClaimName(path)}
		if size := strings.TrimSpace(item.Size); size != "" {
			row["size"] = size
		}
		out = append(out, row)
	}
	return out
}

func apWorkloadPhase(workload apWorkloadView) string {
	if workload.Paused {
		return "Paused"
	}
	if workload.UnavailableReplicas > 0 {
		return "Updating"
	}
	if workload.ReadyReplicas > 0 && workload.ReadyReplicas == workload.StatusReplicas {
		return "Running"
	}
	if workload.Generation > workload.ObservedGeneration {
		return "Updating"
	}
	return "Creating"
}

func deploymentPhase(deployment *appsv1.Deployment) string {
	if deployment == nil {
		return "Creating"
	}
	return apWorkloadPhase(apWorkloadView{
		Annotations:         deployment.Annotations,
		Generation:          deployment.Generation,
		ObservedGeneration:  deployment.Status.ObservedGeneration,
		Paused:              strings.EqualFold(deployment.Annotations[LaunchpadPauseAnnotation], "true"),
		ReadyReplicas:       deployment.Status.ReadyReplicas,
		StatusReplicas:      deployment.Status.Replicas,
		UnavailableReplicas: deployment.Status.UnavailableReplicas,
	})
}
