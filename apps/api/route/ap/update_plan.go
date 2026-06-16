package ap

import (
	"strconv"
	"strings"
	"time"

	orchestration "sealos/api/service/orchestration"
)

func applyAPResourcesPauseState(resources *orchestration.APResources, paused *bool) {
	if resources == nil || paused == nil {
		return
	}
	if resources.Deployment != nil {
		if resources.Deployment.Annotations == nil {
			resources.Deployment.Annotations = map[string]string{}
		}
		resources.Deployment.Annotations[orchestration.LaunchpadPauseAnnotation] = map[bool]string{true: "true", false: "false"}[*paused]
		if *paused {
			replicas := int32(0)
			resources.Deployment.Spec.Replicas = &replicas
			return
		}
		if resources.Deployment.Spec.Replicas == nil || *resources.Deployment.Spec.Replicas < 1 {
			replicas := int32(1)
			resources.Deployment.Spec.Replicas = &replicas
		}
	}
	if resources.StatefulSet != nil {
		if resources.StatefulSet.Annotations == nil {
			resources.StatefulSet.Annotations = map[string]string{}
		}
		resources.StatefulSet.Annotations[orchestration.LaunchpadPauseAnnotation] = map[bool]string{true: "true", false: "false"}[*paused]
		if *paused {
			replicas := int32(0)
			resources.StatefulSet.Spec.Replicas = &replicas
			return
		}
		if resources.StatefulSet.Spec.Replicas == nil || *resources.StatefulSet.Spec.Replicas < 1 {
			replicas := int32(1)
			resources.StatefulSet.Spec.Replicas = &replicas
		}
	}
}

func applyAPResourcesRestartRequest(resources *orchestration.APResources, current map[string]string, restartRequest *int64, now time.Time) {
	if resources == nil || restartRequest == nil {
		return
	}
	value := strconv.FormatInt(*restartRequest, 10)
	if strings.TrimSpace(current[orchestration.APRestartRequestAnnotation]) == value {
		return
	}
	restartedAt := now.Format(time.RFC3339)
	if resources.Deployment != nil {
		if resources.Deployment.Spec.Template.Annotations == nil {
			resources.Deployment.Spec.Template.Annotations = map[string]string{}
		}
		resources.Deployment.Spec.Template.Annotations["kubectl.kubernetes.io/restartedAt"] = restartedAt
	}
	if resources.StatefulSet != nil {
		if resources.StatefulSet.Spec.Template.Annotations == nil {
			resources.StatefulSet.Spec.Template.Annotations = map[string]string{}
		}
		resources.StatefulSet.Spec.Template.Annotations["kubectl.kubernetes.io/restartedAt"] = restartedAt
	}
}

func apRestartRequestFromAnnotations(annotations map[string]string) *int64 {
	raw := strings.TrimSpace(annotations[orchestration.APRestartRequestAnnotation])
	if raw == "" {
		return nil
	}
	value, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || value < 0 {
		return nil
	}
	return &value
}

func mergeAPWorkloadAnnotations(resources *orchestration.APResources, current map[string]string) {
	if resources == nil {
		return
	}
	if resources.Deployment != nil {
		resources.Deployment.Annotations = mergeStringAnnotations(current, resources.Deployment.Annotations)
	}
	if resources.StatefulSet != nil {
		resources.StatefulSet.Annotations = mergeStringAnnotations(current, resources.StatefulSet.Annotations)
	}
}

func mergeStringAnnotations(base map[string]string, overlays ...map[string]string) map[string]string {
	out := map[string]string{}
	for key, value := range base {
		if value != "" {
			out[key] = value
		}
	}
	for _, overlay := range overlays {
		for key, value := range overlay {
			if value != "" {
				out[key] = value
			}
		}
	}
	return out
}
