package ap

import (
	"encoding/json"
	"errors"
	"strings"

	corev1 "k8s.io/api/core/v1"

	orchestration "sealos/api/service/orchestration"
)

func apRenderInputFromWorkloadPatch(current apWorkload, raw json.RawMessage, currentConfigMaps []orchestration.APConfigMapMount) (orchestration.APResourcesInput, *bool, error) {
	var patch map[string]interface{}
	if err := json.Unmarshal(raw, &patch); err != nil {
		return orchestration.APResourcesInput{}, nil, err
	}
	container := corev1.Container{}
	replicas := int32(1)
	projectID := strings.TrimSpace(current.Labels()[orchestration.BrainProjectIDLabel])
	routingDomain := strings.TrimSpace(current.Labels()[orchestration.APRoutingDomainLabel])
	network := desiredAPNetworkFromWorkload(current)
	workloadKind := orchestration.APWorkloadKindDeployment
	imagePullSecrets := []corev1.LocalObjectReference{}
	storage := []orchestration.APStorageMount{}
	storageTemplate := []orchestration.APStorageMount{}
	if current.Deployment != nil {
		if len(current.Deployment.Spec.Template.Spec.Containers) > 0 {
			container = current.Deployment.Spec.Template.Spec.Containers[0]
		}
		imagePullSecrets = current.Deployment.Spec.Template.Spec.ImagePullSecrets
		if current.Deployment.Spec.Replicas != nil {
			replicas = *current.Deployment.Spec.Replicas
		}
	} else if current.StatefulSet != nil {
		workloadKind = orchestration.APWorkloadKindStatefulSet
		if len(current.StatefulSet.Spec.Template.Spec.Containers) > 0 {
			container = current.StatefulSet.Spec.Template.Spec.Containers[0]
		}
		imagePullSecrets = current.StatefulSet.Spec.Template.Spec.ImagePullSecrets
		if current.StatefulSet.Spec.Replicas != nil {
			replicas = *current.StatefulSet.Spec.Replicas
		}
		storage = apStorageInputFromStatefulSet(current.StatefulSet)
		storageTemplate = storage
		if desiredStorage := apDesiredStorageInputFromAnnotations(current.Annotations()); len(desiredStorage) > 0 {
			storage = desiredStorage
		}
	}
	privatePort := int32(80)
	if len(container.Ports) > 0 {
		privatePort = container.Ports[0].ContainerPort
	}
	if network == nil {
		network = map[string]interface{}{"privatePort": privatePort}
	}
	if normalizedPorts, err := orchestration.NormalizeAPAppListeningPortsFromNetwork(network, privatePort); err == nil && len(normalizedPorts) > 0 {
		privatePort = normalizedPorts[0].Port
	}
	args := container.Args
	command := container.Command
	configMaps := currentConfigMaps
	image := container.Image
	imageRegistry := (*orchestration.APImageRegistry)(nil)
	imagePullPolicy := container.ImagePullPolicy
	restartRequest := apRestartRequestFromAnnotations(current.Annotations())
	env := container.Env
	envRawSource := current.Annotations()[orchestration.APEnvRawSourceAnnotation]
	startupProbe := container.StartupProbe
	livenessProbe := container.LivenessProbe
	readinessProbe := container.ReadinessProbe
	limits := container.Resources.Limits
	requests := container.Resources.Requests
	replicaStrategy := orchestration.APReplicaStrategy{
		Fixed: orchestration.APFixedReplicaSettings{Replicas: replicas},
		Type:  "fixed",
	}
	if currentStrategy := apReplicaStrategyFromAnnotation(current.Annotations()[orchestration.APReplicaStrategyAnnotation], replicas); currentStrategy != nil {
		replicaStrategy = *currentStrategy
	}
	var paused *bool

	if metadata, _ := patch["metadata"].(map[string]interface{}); metadata != nil {
		if labels, _ := metadata["labels"].(map[string]interface{}); labels != nil {
			if region := stringFromMap(labels, orchestration.APRoutingDomainLabel); region != "" {
				routingDomain = region
			}
		}
	}
	spec, _ := patch["spec"].(map[string]interface{})
	if value, ok := spec["paused"].(bool); ok {
		paused = &value
		if value {
			replicas = 0
		} else if replicas < 1 {
			replicas = 1
		}
	}
	if input, _ := spec["input"].(map[string]interface{}); input != nil {
		if nextArgs, ok := input["args"].([]interface{}); ok {
			args = stringSliceFromValue(nextArgs)
		}
		if nextCommand, ok := input["command"].([]interface{}); ok {
			command = stringSliceFromValue(nextCommand)
		}
		if _, ok := input["configMaps"].([]interface{}); ok {
			configMaps = apConfigMapsFromInput(input)
		} else if _, ok := input["configMap"].([]interface{}); ok {
			configMaps = apConfigMapsFromInput(input)
		}
		if _, ok := input["storage"].([]interface{}); ok {
			nextStorage := apStorageFromInput(input)
			if err := validateAPStoragePatch(current, storage, nextStorage); err != nil {
				return orchestration.APResourcesInput{}, nil, err
			}
			if current.StatefulSet != nil {
				storageTemplate = storageForStatefulSetTemplate(storage, nextStorage)
				storage = nextStorage
			} else {
				storage = nextStorage
			}
			if len(storage) > 0 {
				workloadKind = orchestration.APWorkloadKindStatefulSet
			}
		}
		if nextImage := stringFromMap(input, "image"); nextImage != "" {
			image = nextImage
		}
		if nextSecrets, ok := input["imagePullSecrets"].([]interface{}); ok {
			imagePullSecrets = imagePullSecretsFromValue(nextSecrets)
		}
		if _, ok := input["imageRegistry"].(map[string]interface{}); ok {
			imageRegistry = imageRegistryFromInput(input)
		} else if _, ok := input["registry"].(map[string]interface{}); ok {
			imageRegistry = imageRegistryFromInput(input)
		}
		if nextPolicy := stringFromMap(input, "imagePullPolicy"); nextPolicy != "" {
			imagePullPolicy = corev1.PullPolicy(nextPolicy)
		}
		if nextEnv, ok := input["env"].([]interface{}); ok {
			env = envVarsFromValue(nextEnv)
		}
		if value, found := input["envRawSource"]; found {
			envRawSource = toString(value)
		}
		if probes, _ := input["probes"].(map[string]interface{}); probes != nil {
			if _, found := probes["startup"]; found {
				startupProbe = probeFromInput(input, "startup")
			}
			if _, found := probes["liveness"]; found {
				livenessProbe = probeFromInput(input, "liveness")
			}
			if _, found := probes["readiness"]; found {
				readinessProbe = probeFromInput(input, "readiness")
			}
		}
		if networkPatch, _ := input["network"].(map[string]interface{}); networkPatch != nil {
			network = mergeAPNetwork(network, networkPatch)
			if normalizedPorts, err := orchestration.NormalizeAPAppListeningPortsFromNetwork(network, privatePort); err == nil && len(normalizedPorts) > 0 {
				privatePort = normalizedPorts[0].Port
			}
		}
	}
	if specWorkload := apWorkloadKindFromSpec(spec); specWorkload != "" {
		if specWorkload != workloadKind {
			return orchestration.APResourcesInput{}, nil, errors.New("existing AP workload.kind cannot be changed")
		}
		workloadKind = specWorkload
	}
	if rawRestartRequest, ok := spec["restartRequest"]; ok {
		nextRestartRequest, ok := int64Value(rawRestartRequest)
		if !ok || nextRestartRequest < 0 {
			return orchestration.APResourcesInput{}, nil, errors.New("spec.restartRequest must be a non-negative integer")
		}
		restartRequest = &nextRestartRequest
	}
	if resourceSpec, _ := spec["resource"].(map[string]interface{}); resourceSpec != nil {
		if nextStrategy := apReplicaStrategyFromResourceSpec(resourceSpec); nextStrategy != nil {
			replicaStrategy = *nextStrategy
		}
		if nextReplicas := apReplicasFromResourceSpec(resourceSpec); nextReplicas > 0 && !(paused != nil && *paused) {
			replicas = nextReplicas
		}
		if nextLimits := resourceListFromMap(resourceSpec, "limits"); len(nextLimits) > 0 {
			limits = nextLimits
		}
		if nextRequests := resourceListFromMap(resourceSpec, "requests"); len(nextRequests) > 0 {
			requests = nextRequests
		}
	}
	return orchestration.APResourcesInput{
		Args:             args,
		Command:          command,
		ConfigMaps:       configMaps,
		Env:              env,
		EnvRawSource:     envRawSource,
		Image:            image,
		ImagePullSecrets: imagePullSecrets,
		ImagePullPolicy:  imagePullPolicy,
		ImageRegistry:    imageRegistry,
		LivenessProbe:    livenessProbe,
		Name:             current.Name(),
		Namespace:        current.Namespace(),
		NetworkJSON:      networkJSONFromMap(network),
		PrivatePort:      privatePort,
		ProjectID:        projectID,
		ReadinessProbe:   readinessProbe,
		Replicas:         replicas,
		ResourceLimit:    limits,
		ResourceReq:      requests,
		ReplicaStrategy:  &replicaStrategy,
		RestartRequest:   restartRequest,
		RoutingDomain:    routingDomain,
		Storage:          storage,
		StorageTemplate:  storageTemplate,
		StartupProbe:     startupProbe,
		WorkloadKind:     workloadKind,
	}, paused, nil
}

func desiredAPNetworkFromWorkload(workload apWorkload) map[string]interface{} {
	raw := strings.TrimSpace(workload.Annotations()[orchestration.APDesiredNetworkAnnotation])
	if raw == "" {
		return nil
	}
	var network map[string]interface{}
	if err := json.Unmarshal([]byte(raw), &network); err != nil {
		return nil
	}
	return network
}

func mergeAPNetwork(current map[string]interface{}, patch map[string]interface{}) map[string]interface{} {
	out := map[string]interface{}{}
	for key, value := range current {
		out[key] = value
	}
	for key, value := range patch {
		if value == nil {
			delete(out, key)
			continue
		}
		out[key] = value
	}
	return out
}
