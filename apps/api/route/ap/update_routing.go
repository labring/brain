package ap

import (
	"encoding/json"
	"strings"

	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
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

// currentAPServiceAnnotations reads the annotations of the AP's own Service,
// where Port Display Names live (ADR 0080). A missing Service is not an error:
// there is nothing to preserve.
func currentAPServiceAnnotations(cfg *clientcmdapi.Config, workload apWorkload) (map[string]string, error) {
	return currentAPServiceAnnotationsByName(cfg, workload.Name(), workload.Namespace())
}

func currentAPServiceAnnotationsByName(cfg *clientcmdapi.Config, name, namespace string) (map[string]string, error) {
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
	return service.GetAnnotations(), nil
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
