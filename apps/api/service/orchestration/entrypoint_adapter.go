package orchestration

import (
	"sort"
	"strings"

	networkingv1 "k8s.io/api/networking/v1"
)

func EntryPointObjectFromIngress(ingress *networkingv1.Ingress) map[string]interface{} {
	if ingress == nil {
		return nil
	}
	entryPoints := EntryPointObjectsFromIngresses([]networkingv1.Ingress{*ingress})
	if len(entryPoints) == 0 {
		return nil
	}
	return entryPoints[0]
}

func EntryPointObjectsFromIngresses(ingresses []networkingv1.Ingress) []map[string]interface{} {
	groups := map[string]*entryPointIngressGroup{}
	for i := range ingresses {
		ingress := &ingresses[i]
		apName := entryPointAPName(ingress)
		if apName == "" {
			continue
		}
		namespace := strings.TrimSpace(ingress.Namespace)
		key := namespace + "/" + apName
		group := groups[key]
		if group == nil {
			group = &entryPointIngressGroup{
				apName:    apName,
				labels:    map[string]interface{}{},
				namespace: namespace,
			}
			groups[key] = group
		}
		group.addIngress(ingress)
	}

	keys := make([]string, 0, len(groups))
	for key := range groups {
		keys = append(keys, key)
	}
	sort.Strings(keys)

	out := make([]map[string]interface{}, 0, len(keys))
	for _, key := range keys {
		out = append(out, groups[key].object())
	}
	return out
}

type entryPointIngressGroup struct {
	apName            string
	creationTimestamp string
	labels            map[string]interface{}
	namespace         string
	targets           []interface{}
	uids              []string
}

func (group *entryPointIngressGroup) addIngress(ingress *networkingv1.Ingress) {
	if ingress == nil {
		return
	}
	for key, value := range ingress.Labels {
		if _, exists := group.labels[key]; !exists {
			group.labels[key] = value
		}
	}
	if group.creationTimestamp == "" || ingress.CreationTimestamp.String() < group.creationTimestamp {
		group.creationTimestamp = ingress.CreationTimestamp.String()
	}
	if uid := strings.TrimSpace(string(ingress.UID)); uid != "" {
		group.uids = append(group.uids, uid)
	}
	for _, rule := range ingress.Spec.Rules {
		for _, path := range httpPaths(rule) {
			port := int32(0)
			serviceName := ""
			if path.Backend.Service != nil {
				serviceName = path.Backend.Service.Name
				port = path.Backend.Service.Port.Number
			}
			target := map[string]interface{}{
				"host":           rule.Host,
				"platformDomain": rule.Host,
				"port":           port,
				"serviceName":    serviceName,
				"status":         "accessible",
				"url":            "https://" + rule.Host + "/",
			}
			if id := strings.TrimSpace(ingress.Labels["brain.io/public-address-id"]); id != "" {
				target["id"] = id
			}
			if kind := strings.TrimSpace(ingress.Labels["brain.io/public-address-kind"]); kind != "" {
				target["type"] = kind
			}
			group.targets = append(group.targets, target)
		}
	}
}

func (group *entryPointIngressGroup) object() map[string]interface{} {
	return map[string]interface{}{
		"apiVersion": "brain.io/direct",
		"kind":       "EntryPoint",
		"metadata": map[string]interface{}{
			"creationTimestamp": group.creationTimestamp,
			"labels":            group.labels,
			"name":              group.apName,
			"namespace":         group.namespace,
			"uid":               strings.Join(group.uids, ","),
		},
		"spec": map[string]interface{}{
			"apRef": group.apName,
		},
		"status": map[string]interface{}{
			"phase":   "Running",
			"targets": group.targets,
		},
	}
}

func entryPointAPName(ingress *networkingv1.Ingress) string {
	if ingress == nil {
		return ""
	}
	apName := strings.TrimSpace(ingress.Labels[BrainAppNameLabel])
	if apName == "" {
		apName = strings.TrimSuffix(ingress.Name, "-ingress")
	}
	return strings.TrimSpace(apName)
}

func httpPaths(rule networkingv1.IngressRule) []networkingv1.HTTPIngressPath {
	if rule.HTTP == nil {
		return nil
	}
	return rule.HTTP.Paths
}
