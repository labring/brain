package ap

import (
	"encoding/json"
	"strings"

	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/client-go/rest"
	clientcmdapi "k8s.io/client-go/tools/clientcmd/api"

	k8ssvc "sealos/api/service/k8s"
	orchestration "sealos/api/service/orchestration"
)

func deleteAPHPA(cfg *clientcmdapi.Config, name, namespace string) error {
	_, err := k8ssvc.Delete(cfg, k8ssvc.DeleteOptions{
		Name:      name,
		Namespace: namespace,
		Resource:  "horizontalpodautoscalers",
	})
	if apierrors.IsNotFound(err) || k8ssvc.IsUnknownResourceError(err, "horizontalpodautoscalers") {
		return nil
	}
	return err
}

func deleteAPConfigMap(cfg *clientcmdapi.Config, name, namespace string) error {
	_, err := k8ssvc.Delete(cfg, k8ssvc.DeleteOptions{
		Name:      orchestration.APConfigMapName(name),
		Namespace: namespace,
		Resource:  "configmaps",
	})
	if apierrors.IsNotFound(err) || k8ssvc.IsUnknownResourceError(err, "configmaps") {
		return nil
	}
	return err
}

func deleteAPImagePullSecret(cfg *clientcmdapi.Config, name, namespace string) error {
	_, err := k8ssvc.Delete(cfg, k8ssvc.DeleteOptions{
		Name:      orchestration.APImagePullSecretName(name),
		Namespace: namespace,
		Resource:  "secrets",
	})
	if apierrors.IsNotFound(err) || k8ssvc.IsUnknownResourceError(err, "secrets") {
		return nil
	}
	return err
}

func apInputReferencesGeneratedImagePullSecret(input orchestration.APResourcesInput) bool {
	generatedName := orchestration.APImagePullSecretName(input.Name)
	if input.ImageRegistry != nil {
		return true
	}
	for _, secret := range input.ImagePullSecrets {
		if secret.Name == generatedName {
			return true
		}
	}
	return false
}

func replaceAPPublicIngresses(restConfig *rest.Config, cfg *clientcmdapi.Config, name, namespace string, input orchestration.APResourcesInput) error {
	for _, selector := range apPublicRoutingSupportSelectors(name, input.ProjectID) {
		for _, resource := range []string{"ingresses", "certificates", "issuers"} {
			if _, err := k8ssvc.Delete(cfg, k8ssvc.DeleteOptions{
				LabelSelector: selector,
				Namespace:     namespace,
				Resource:      resource,
			}); err != nil && !apierrors.IsNotFound(err) && !k8ssvc.IsUnknownResourceError(err, resource) {
				return err
			}
		}
	}
	var network map[string]interface{}
	if strings.TrimSpace(input.NetworkJSON) != "" {
		if err := json.Unmarshal([]byte(input.NetworkJSON), &network); err != nil {
			return err
		}
	}
	obj := unstructured.Unstructured{Object: map[string]interface{}{
		"metadata": map[string]interface{}{
			"labels":    map[string]interface{}{orchestration.APRoutingDomainLabel: input.RoutingDomain},
			"name":      name,
			"namespace": namespace,
		},
		"spec": map[string]interface{}{
			"projectId": input.ProjectID,
			"input": map[string]interface{}{
				"network": network,
			},
		},
	}}
	normalizeAPPublicNetworkIntent(&obj, namespace)
	objects, err := apPublicIngressesFromObject(obj, namespace)
	if err != nil {
		return err
	}
	if len(objects) == 0 {
		return nil
	}
	return k8ssvc.ApplyObjects(restConfig, objects, namespace)
}

// apPortMetadataStore is where an AP's Port Display Names and Default Open
// Port live (ADR 0080): the AP's own Service for a Brain-created AP, or the
// template's Services for an adopted Template Instance, which has none of
// its own.
type apPortMetadataStore struct {
	// annotations are the live annotations the preserve rule reads.
	annotations map[string]string
	// templateServices are the Services that stand in for the AP's own; empty
	// when the AP has its own Service (or none at all).
	templateServices []map[string]interface{}
}

// currentAPPortMetadataStore reads the Service annotations an AP update
// preserves and decides which Services the update writes them back to. The
// AP's own Service wins when it exists. Otherwise the AP was adopted from a
// template and its ports are exposed by the template's Services, so the
// annotations are read across those and written back to them rather than
// to a Brain Service the AP never had. A missing Service is not an error:
// there is nothing to preserve.
func currentAPPortMetadataStore(cfg *clientcmdapi.Config, workload apWorkload) (apPortMetadataStore, error) {
	own, err := currentAPService(cfg, workload.Name(), workload.Namespace())
	if err != nil {
		return apPortMetadataStore{}, err
	}
	if own != nil {
		return apPortMetadataStore{annotations: own.GetAnnotations()}, nil
	}
	services, err := currentAPPublicAccessSupportResources(cfg, workload, "services")
	if err != nil {
		return apPortMetadataStore{}, err
	}
	if len(services) == 0 {
		return apPortMetadataStore{}, nil
	}
	return apPortMetadataStore{
		annotations:      apPortMetadataAnnotationsFromServices(services),
		templateServices: services,
	}, nil
}

// currentAPServiceAnnotations reads the annotations of the AP's own Service
// for the create, redeploy, and rollback paths, which apply that Service as
// a whole object (ADR 0080). A missing Service reads as nothing to preserve.
func currentAPServiceAnnotations(cfg *clientcmdapi.Config, workload apWorkload) (map[string]string, error) {
	return currentAPServiceAnnotationsByName(cfg, workload.Name(), workload.Namespace())
}

func currentAPServiceAnnotationsByName(cfg *clientcmdapi.Config, name, namespace string) (map[string]string, error) {
	service, err := currentAPService(cfg, name, namespace)
	if err != nil || service == nil {
		return nil, err
	}
	return service.GetAnnotations(), nil
}

func currentAPService(cfg *clientcmdapi.Config, name, namespace string) (*unstructured.Unstructured, error) {
	serviceJSON, err := k8ssvc.Get(cfg, k8ssvc.GetOptions{
		Name:      orchestration.APServiceName(name),
		Namespace: namespace,
		Resource:  "services",
	})
	if apierrors.IsNotFound(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var service unstructured.Unstructured
	if err := json.Unmarshal(serviceJSON, &service.Object); err != nil {
		return nil, err
	}
	return &service, nil
}

// apPortMetadataAnnotationsFromServices merges the port metadata annotations
// of several Services into the map the preserve rule reads: the first
// Service to carry a key wins, mirroring how the read model resolves them.
func apPortMetadataAnnotationsFromServices(services []map[string]interface{}) map[string]string {
	out := map[string]string{}
	for _, service := range services {
		for key, value := range unstructuredAnnotations(service) {
			if !isAPPortMetadataAnnotation(key) {
				continue
			}
			if _, ok := out[key]; !ok {
				out[key] = value
			}
		}
	}
	return out
}

func isAPPortMetadataAnnotation(key string) bool {
	return key == orchestration.BrainDefaultOpenPortAnnotation || strings.HasPrefix(key, orchestration.BrainPortDisplayNameAnnotationPrefix)
}

func unstructuredAnnotations(object map[string]interface{}) map[string]string {
	metadata, _ := object["metadata"].(map[string]interface{})
	raw, _ := metadata["annotations"].(map[string]interface{})
	out := make(map[string]string, len(raw))
	for key, value := range raw {
		if text, ok := value.(string); ok {
			out[key] = text
		}
	}
	return out
}

func unstructuredServicePorts(service map[string]interface{}) []int32 {
	spec, _ := service["spec"].(map[string]interface{})
	rawPorts, _ := spec["ports"].([]interface{})
	out := []int32{}
	for _, item := range rawPorts {
		portMap, _ := item.(map[string]interface{})
		if portMap == nil {
			continue
		}
		switch port := portMap["port"].(type) {
		case float64:
			out = append(out, int32(port))
		case int64:
			out = append(out, int32(port))
		case int:
			out = append(out, int32(port))
		}
	}
	return out
}

// retargetAPServiceMetadata redirects the port metadata of a rendered AP
// Service to the template Services that already expose the AP's ports
// (ADR 0080: adopted Template Instances keep their names on the template's
// Services). With no template Services the plan is left alone and the
// rendered Service is applied as usual. Otherwise the rendered Service is
// dropped from the plan and each template Service exposing one of the AP's
// ports gets a merge patch setting, or clearing, the Port Display Name of
// every port it exposes and the Default Open Port when it exposes that port.
// Patches that would change nothing are omitted.
func retargetAPServiceMetadata(plan *apUpdatePlan, templateServices []map[string]interface{}) {
	if plan == nil || plan.Resources == nil || plan.Resources.Service == nil || len(templateServices) == 0 {
		return
	}
	rendered := plan.Resources.Service
	inPlan := false
	supportObjects := make([]runtime.Object, 0, len(plan.SupportObjects))
	for _, object := range plan.SupportObjects {
		if service, ok := object.(*corev1.Service); ok && service == rendered {
			inPlan = true
			continue
		}
		supportObjects = append(supportObjects, object)
	}
	if !inPlan {
		return
	}
	plan.SupportObjects = supportObjects
	plan.ServicePatches = apTemplateServicePortMetadataPatches(rendered, templateServices)
}

func apTemplateServicePortMetadataPatches(rendered *corev1.Service, templateServices []map[string]interface{}) []apServicePatch {
	apPorts := map[int32]bool{}
	for _, port := range rendered.Spec.Ports {
		apPorts[port.Port] = true
	}
	defaultOpenPort, hasDefaultOpenPort := orchestration.DefaultOpenPortFromAnnotations(rendered.Annotations)
	patches := []apServicePatch{}
	for _, service := range templateServices {
		name := strings.TrimSpace(getStringFromUnstructured(service, "metadata", "name"))
		if name == "" {
			continue
		}
		live := unstructuredAnnotations(service)
		annotations := map[string]interface{}{}
		exposesDefaultOpenPort := false
		for _, port := range unstructuredServicePorts(service) {
			if !apPorts[port] {
				continue
			}
			if hasDefaultOpenPort && port == defaultOpenPort {
				exposesDefaultOpenPort = true
			}
			key := orchestration.BrainPortDisplayNameAnnotation(port)
			setAnnotationPatch(annotations, live, key, rendered.Annotations[key])
		}
		if exposesDefaultOpenPort {
			setAnnotationPatch(annotations, live, orchestration.BrainDefaultOpenPortAnnotation, rendered.Annotations[orchestration.BrainDefaultOpenPortAnnotation])
		} else if hasDefaultOpenPort || len(annotations) > 0 {
			// The choice moved to another Service, or this one is being
			// written anyway: a stale choice here must not shadow it.
			setAnnotationPatch(annotations, live, orchestration.BrainDefaultOpenPortAnnotation, "")
		}
		if len(annotations) == 0 {
			continue
		}
		patch, err := json.Marshal(map[string]interface{}{
			"metadata": map[string]interface{}{"annotations": annotations},
		})
		if err != nil {
			continue
		}
		patches = append(patches, apServicePatch{Name: name, Patch: patch})
	}
	return patches
}

// setAnnotationPatch records one annotation write in a merge patch when the
// live value differs: a non-empty value sets it, an empty one clears it
// (JSON merge patch null).
func setAnnotationPatch(patch map[string]interface{}, live map[string]string, key, value string) {
	value = strings.TrimSpace(value)
	current, exists := live[key]
	if value == "" {
		if exists {
			patch[key] = nil
		}
		return
	}
	if !exists || current != value {
		patch[key] = value
	}
}

func getStringFromUnstructured(object map[string]interface{}, path ...string) string {
	var current interface{} = object
	for _, key := range path {
		next, _ := current.(map[string]interface{})
		if next == nil {
			return ""
		}
		current = next[key]
	}
	text, _ := current.(string)
	return text
}

func apPublicRoutingSupportSelectors(name string, projectID string) []string {
	return []string{
		apPublicRoutingSupportSelector(name, projectID),
	}
}

func apPublicRoutingSupportSelector(name string, projectID string) string {
	projectSelector := orchestration.BrainProjectIDLabel
	if trimmed := strings.TrimSpace(projectID); trimmed != "" {
		projectSelector += "=" + trimmed
	}
	return orchestration.LaunchpadAppDeployManagerLabel + "=" + name + "," +
		orchestration.BrainManagedByLabel + "=" + orchestration.BrainManagedByValue + "," +
		projectSelector
}
