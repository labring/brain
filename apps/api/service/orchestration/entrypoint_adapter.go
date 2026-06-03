package orchestration

import (
	"strings"

	networkingv1 "k8s.io/api/networking/v1"
)

func EntryPointObjectFromIngress(ingress *networkingv1.Ingress) map[string]interface{} {
	if ingress == nil {
		return nil
	}
	labels := map[string]interface{}{}
	for key, value := range ingress.Labels {
		labels[key] = value
	}
	apName := strings.TrimSpace(ingress.Labels[BrainAppNameLabel])
	if apName == "" {
		apName = strings.TrimSuffix(ingress.Name, "-ingress")
	}
	targets := make([]interface{}, 0, len(ingress.Spec.Rules))
	for _, rule := range ingress.Spec.Rules {
		for _, path := range httpPaths(rule) {
			port := int32(0)
			serviceName := ""
			if path.Backend.Service != nil {
				serviceName = path.Backend.Service.Name
				port = path.Backend.Service.Port.Number
			}
			targets = append(targets, map[string]interface{}{
				"host":           rule.Host,
				"platformDomain": rule.Host,
				"port":           port,
				"serviceName":    serviceName,
				"status":         "accessible",
				"url":            "https://" + rule.Host + "/",
			})
		}
	}
	return map[string]interface{}{
		"apiVersion": "brain.io/direct",
		"kind":       "EntryPoint",
		"metadata": map[string]interface{}{
			"creationTimestamp": ingress.CreationTimestamp.String(),
			"labels":            labels,
			"name":              ingress.Name,
			"namespace":         ingress.Namespace,
			"uid":               string(ingress.UID),
		},
		"spec": map[string]interface{}{
			"apRef": apName,
		},
		"status": map[string]interface{}{
			"phase":   "Running",
			"targets": targets,
		},
	}
}

func httpPaths(rule networkingv1.IngressRule) []networkingv1.HTTPIngressPath {
	if rule.HTTP == nil {
		return nil
	}
	return rule.HTTP.Paths
}
