package orchestration

import (
	"strings"

	appsv1 "k8s.io/api/apps/v1"
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
	privatePort := int32(0)
	env := []interface{}{}
	if len(deployment.Spec.Template.Spec.Containers) > 0 {
		container := deployment.Spec.Template.Spec.Containers[0]
		image = container.Image
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
	phase := deploymentPhase(deployment)
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
				"env":   env,
				"image": image,
				"network": map[string]interface{}{
					"privatePort": privatePort,
				},
			},
			"name": deployment.Name,
			"resource": map[string]interface{}{
				"replicaStrategy": map[string]interface{}{
					"fixed": map[string]interface{}{
						"replicas": replicas,
					},
					"type": "fixed",
				},
				"replicas": replicas,
			},
			"paused": strings.EqualFold(deployment.Annotations[LaunchpadPauseAnnotation], "true"),
		},
		"status": map[string]interface{}{
			"availableReplicas": deployment.Status.AvailableReplicas,
			"phase":             phase,
			"readyReplicas":     deployment.Status.ReadyReplicas,
			"replicas":          deployment.Status.Replicas,
		},
	}
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
