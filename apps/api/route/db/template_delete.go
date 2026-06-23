package db

import (
	"encoding/json"
	"errors"
	"strings"

	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	clientcmdapi "k8s.io/client-go/tools/clientcmd/api"

	k8ssvc "sealos/api/service/k8s"
	orchestration "sealos/api/service/orchestration"
)

type templateDeploymentRef struct {
	Name      string
	ProjectID string
}

func deleteTemplateDeploymentResources(cfg *clientcmdapi.Config, ref templateDeploymentRef, namespace string) error {
	name := strings.TrimSpace(ref.Name)
	projectID := strings.TrimSpace(ref.ProjectID)
	if name == "" || projectID == "" {
		return apierrors.NewBadRequest("template deployment name is required")
	}

	if err := validateTemplateDeploymentInstance(cfg, name, projectID, namespace); err != nil {
		return err
	}

	if _, err := k8ssvc.Delete(cfg, k8ssvc.DeleteOptions{
		Name:      name,
		Namespace: namespace,
		Resource:  "instances",
	}); err != nil && !apierrors.IsNotFound(err) && !k8ssvc.IsUnknownResourceError(err, "instances") {
		return err
	}

	selector := orchestration.BrainManagedByLabel + "=" + orchestration.BrainManagedByValue + "," + orchestration.BrainProjectIDLabel + "=" + projectID + "," + orchestration.BrainDeploymentKindLabel + "=" + orchestration.DeploymentKindTemplate + "," + orchestration.BrainDeploymentNameLabel + "=" + name
	for _, resource := range templateDeploymentDeleteResources() {
		if _, err := k8ssvc.Delete(cfg, k8ssvc.DeleteOptions{
			LabelSelector: selector,
			Namespace:     namespace,
			Resource:      resource,
		}); err != nil && !apierrors.IsNotFound(err) && !k8ssvc.IsUnknownResourceError(err, resource) {
			return err
		}
	}
	return nil
}

func validateTemplateDeploymentInstance(cfg *clientcmdapi.Config, name, projectID, namespace string) error {
	raw, err := k8ssvc.Get(cfg, k8ssvc.GetOptions{
		Name:      name,
		Namespace: namespace,
		Resource:  "instances",
	})
	if err != nil {
		if apierrors.IsNotFound(err) || k8ssvc.IsUnknownResourceError(err, "instances") {
			return nil
		}
		return err
	}
	var instance unstructured.Unstructured
	if err := json.Unmarshal(raw, &instance); err != nil {
		return err
	}
	labels := instance.GetLabels()
	if labels[orchestration.BrainManagedByLabel] != orchestration.BrainManagedByValue ||
		labels[orchestration.BrainProjectIDLabel] != projectID ||
		labels[orchestration.BrainDeploymentKindLabel] != orchestration.DeploymentKindTemplate ||
		labels[orchestration.BrainDeploymentNameLabel] != name {
		return errors.New("template Instance does not match Brain deployment ownership labels")
	}
	return nil
}

func templateDeploymentDeleteResources() []string {
	return []string{
		"deployments",
		"statefulsets",
		"services",
		"ingresses",
		"certificates",
		"issuers",
		"horizontalpodautoscalers",
		"clusters",
		"opsrequests",
		"configmaps",
		"secrets",
		"persistentvolumeclaims",
		"jobs",
	}
}
