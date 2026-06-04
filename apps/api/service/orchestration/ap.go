package orchestration

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"regexp"
	"strings"

	appsv1 "k8s.io/api/apps/v1"
	autoscalingv2 "k8s.io/api/autoscaling/v2"
	corev1 "k8s.io/api/core/v1"
	networkingv1 "k8s.io/api/networking/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/util/intstr"
)

type APResourcesInput struct {
	Env             []corev1.EnvVar
	Image           string
	ImagePullPolicy corev1.PullPolicy
	Name            string
	Namespace       string
	PrivatePort     int32
	ProjectID       string
	Replicas        int32
	ResourceLimit   corev1.ResourceList
	ResourceReq     corev1.ResourceList
	RoutingDomain   string
	NetworkJSON     string
	ReplicaStrategy *APReplicaStrategy
}

type APResources struct {
	Deployment *appsv1.Deployment
	HPA        *autoscalingv2.HorizontalPodAutoscaler
	Service    *corev1.Service
}

type APReplicaStrategy struct {
	Type    string
	Fixed   APFixedReplicaSettings
	Elastic *APElasticReplicaSettings
}

type APFixedReplicaSettings struct {
	Replicas int32
}

type APElasticReplicaSettings struct {
	MaxReplicas int32
	MinReplicas int32
	Target      APElasticReplicaTarget
}

type APElasticReplicaTarget struct {
	AverageValue       string
	Metric             string
	Type               string
	UtilizationPercent int32
}

func RenderAPResources(input APResourcesInput) (*APResources, error) {
	name := strings.TrimSpace(input.Name)
	namespace := strings.TrimSpace(input.Namespace)
	projectID := strings.TrimSpace(input.ProjectID)
	image := strings.TrimSpace(input.Image)
	if name == "" || namespace == "" || projectID == "" || image == "" {
		return nil, fmt.Errorf("name, namespace, projectID, and image are required")
	}
	port := input.PrivatePort
	if port <= 0 {
		port = 80
	}
	replicaStrategy := normalizeAPReplicaStrategy(input.ReplicaStrategy, input.Replicas)
	replicas := replicaStrategy.Fixed.Replicas
	if replicaStrategy.Type == "elastic" && replicaStrategy.Elastic != nil {
		replicas = replicaStrategy.Elastic.MinReplicas
	}

	labels := mergeStringMap(
		brainLabels(projectID, ResourceKindAP, name),
		map[string]string{
			BrainAppNameLabel:              name,
			LaunchpadAppDeployManagerLabel: name,
			LaunchpadAppLabel:              name,
		},
	)
	managerLabels := mergeStringMap(
		brainLabels(projectID, ResourceKindAP, name),
		map[string]string{
			BrainAppNameLabel:              name,
			LaunchpadAppDeployManagerLabel: name,
		},
	)
	if domain := strings.TrimSpace(input.RoutingDomain); domain != "" {
		managerLabels[APRoutingDomainLabel] = domain
		labels[APRoutingDomainLabel] = domain
	}
	annotations := map[string]string{}
	if networkJSON := strings.TrimSpace(input.NetworkJSON); networkJSON != "" {
		annotations[APDesiredNetworkAnnotation] = networkJSON
	}
	if replicaStrategyJSON := apReplicaStrategyJSON(replicaStrategy); replicaStrategyJSON != "" {
		annotations[APReplicaStrategyAnnotation] = replicaStrategyJSON
	}
	requests := input.ResourceReq
	if requests == nil {
		requests = corev1.ResourceList{
			corev1.ResourceCPU:    resource.MustParse("200m"),
			corev1.ResourceMemory: resource.MustParse("256Mi"),
		}
	}
	limits := input.ResourceLimit
	if limits == nil {
		limits = corev1.ResourceList{
			corev1.ResourceCPU:    resource.MustParse("2000m"),
			corev1.ResourceMemory: resource.MustParse("2Gi"),
		}
	}

	deployment := &appsv1.Deployment{
		TypeMeta: metav1.TypeMeta{
			APIVersion: "apps/v1",
			Kind:       "Deployment",
		},
		ObjectMeta: metav1.ObjectMeta{
			Annotations: annotations,
			Labels:      managerLabels,
			Name:        name,
			Namespace:   namespace,
		},
		Spec: appsv1.DeploymentSpec{
			Replicas: &replicas,
			Selector: &metav1.LabelSelector{
				MatchLabels: map[string]string{LaunchpadAppLabel: name},
			},
			Template: corev1.PodTemplateSpec{
				ObjectMeta: metav1.ObjectMeta{Labels: labels},
				Spec: corev1.PodSpec{
					Containers: []corev1.Container{
						{
							Env:             input.Env,
							Image:           image,
							ImagePullPolicy: normalizeImagePullPolicy(input.ImagePullPolicy),
							Name:            name,
							Ports: []corev1.ContainerPort{
								{ContainerPort: port, Name: "http", Protocol: corev1.ProtocolTCP},
							},
							Resources: corev1.ResourceRequirements{
								Limits:   limits,
								Requests: requests,
							},
						},
					},
				},
			},
		},
	}

	service := &corev1.Service{
		TypeMeta: metav1.TypeMeta{
			APIVersion: "v1",
			Kind:       "Service",
		},
		ObjectMeta: metav1.ObjectMeta{
			Labels:    managerLabels,
			Name:      APServiceName(name),
			Namespace: namespace,
		},
		Spec: corev1.ServiceSpec{
			Ports: []corev1.ServicePort{
				{Name: "http", Port: port, Protocol: corev1.ProtocolTCP, TargetPort: intstr.FromInt32(port)},
			},
			Selector: map[string]string{LaunchpadAppLabel: name},
			Type:     corev1.ServiceTypeClusterIP,
		},
	}

	resources := &APResources{
		Deployment: deployment,
		Service:    service,
	}
	if replicaStrategy.Type == "elastic" && replicaStrategy.Elastic != nil {
		resources.HPA = renderAPHPA(name, namespace, projectID, replicaStrategy.Elastic)
	}
	return resources, nil
}

func APServiceName(apName string) string {
	return dns1035SupportName(apName, "ap", "-service", 63)
}

func dns1035SupportName(name, prefix, suffix string, maxLen int) string {
	base := strings.ToLower(strings.TrimSpace(name))
	base = apPublicAddressResourceNameUnsafeCharsPattern.ReplaceAllString(base, "-")
	base = strings.Trim(base, "-")
	if base == "" {
		base = "resource"
	}
	if base[0] < 'a' || base[0] > 'z' {
		base = strings.Trim(prefix, "-") + "-" + base
	}
	limit := maxLen - len(suffix)
	if limit < 1 {
		limit = maxLen
	}
	if len(base) > limit {
		base = strings.TrimRight(base[:limit], "-")
	}
	out := base + suffix
	if len(out) > maxLen {
		out = strings.TrimRight(out[:maxLen], "-")
	}
	if out == "" || out[0] < 'a' || out[0] > 'z' {
		return strings.Trim(prefix, "-") + suffix
	}
	return out
}

func normalizeImagePullPolicy(policy corev1.PullPolicy) corev1.PullPolicy {
	switch policy {
	case corev1.PullAlways, corev1.PullIfNotPresent, corev1.PullNever:
		return policy
	default:
		return corev1.PullAlways
	}
}

func normalizeAPReplicaStrategy(strategy *APReplicaStrategy, fallbackReplicas int32) APReplicaStrategy {
	replicas := fallbackReplicas
	if replicas < 1 {
		replicas = 1
	}
	if strategy == nil {
		return APReplicaStrategy{
			Type:  "fixed",
			Fixed: APFixedReplicaSettings{Replicas: replicas},
		}
	}
	fixedReplicas := strategy.Fixed.Replicas
	if fixedReplicas < 1 {
		fixedReplicas = replicas
	}
	out := APReplicaStrategy{
		Type:  strings.TrimSpace(strategy.Type),
		Fixed: APFixedReplicaSettings{Replicas: fixedReplicas},
	}
	if out.Type != "elastic" {
		out.Type = "fixed"
		return out
	}
	elastic := strategy.Elastic
	if elastic == nil {
		out.Type = "fixed"
		return out
	}
	minReplicas := elastic.MinReplicas
	if minReplicas < 1 {
		minReplicas = 1
	}
	maxReplicas := elastic.MaxReplicas
	if maxReplicas < minReplicas {
		maxReplicas = minReplicas
	}
	targetMetric := strings.TrimSpace(elastic.Target.Metric)
	targetType := strings.TrimSpace(elastic.Target.Type)
	target := APElasticReplicaTarget{
		AverageValue:       strings.TrimSpace(elastic.Target.AverageValue),
		Metric:             targetMetric,
		Type:               targetType,
		UtilizationPercent: elastic.Target.UtilizationPercent,
	}
	if target.Metric == "memory" {
		target.Metric = "memory"
		target.Type = "averageValue"
		if target.AverageValue == "" {
			target.AverageValue = "512Mi"
		}
	} else {
		target.Metric = "cpu"
		target.Type = "utilization"
		if target.UtilizationPercent < 1 {
			target.UtilizationPercent = 80
		}
	}
	out.Elastic = &APElasticReplicaSettings{
		MaxReplicas: maxReplicas,
		MinReplicas: minReplicas,
		Target:      target,
	}
	return out
}

func apReplicaStrategyJSON(strategy APReplicaStrategy) string {
	value := map[string]interface{}{
		"fixed": map[string]interface{}{
			"replicas": strategy.Fixed.Replicas,
		},
		"type": strategy.Type,
	}
	if strategy.Type == "elastic" && strategy.Elastic != nil {
		target := map[string]interface{}{
			"metric": strategy.Elastic.Target.Metric,
			"type":   strategy.Elastic.Target.Type,
		}
		if strategy.Elastic.Target.Metric == "memory" {
			target["averageValue"] = strategy.Elastic.Target.AverageValue
		} else {
			target["utilizationPercent"] = strategy.Elastic.Target.UtilizationPercent
		}
		value["elastic"] = map[string]interface{}{
			"maxReplicas": strategy.Elastic.MaxReplicas,
			"minReplicas": strategy.Elastic.MinReplicas,
			"target":      target,
		}
	}
	bytes, err := json.Marshal(value)
	if err != nil {
		return ""
	}
	return string(bytes)
}

func renderAPHPA(name string, namespace string, projectID string, elastic *APElasticReplicaSettings) *autoscalingv2.HorizontalPodAutoscaler {
	minReplicas := elastic.MinReplicas
	metricName := corev1.ResourceCPU
	target := autoscalingv2.MetricTarget{Type: autoscalingv2.UtilizationMetricType}
	if elastic.Target.Metric == "memory" {
		metricName = corev1.ResourceMemory
		target.Type = autoscalingv2.AverageValueMetricType
		averageValue := resource.MustParse(elastic.Target.AverageValue)
		target.AverageValue = &averageValue
	} else {
		utilizationPercent := elastic.Target.UtilizationPercent
		target.AverageUtilization = &utilizationPercent
	}
	return &autoscalingv2.HorizontalPodAutoscaler{
		TypeMeta: metav1.TypeMeta{
			APIVersion: "autoscaling/v2",
			Kind:       "HorizontalPodAutoscaler",
		},
		ObjectMeta: metav1.ObjectMeta{
			Labels: mergeStringMap(
				brainLabels(projectID, ResourceKindAP, name),
				map[string]string{BrainAppNameLabel: name},
			),
			Name:      name,
			Namespace: namespace,
		},
		Spec: autoscalingv2.HorizontalPodAutoscalerSpec{
			MaxReplicas: elastic.MaxReplicas,
			MinReplicas: &minReplicas,
			Metrics: []autoscalingv2.MetricSpec{
				{
					Type: autoscalingv2.ResourceMetricSourceType,
					Resource: &autoscalingv2.ResourceMetricSource{
						Name:   metricName,
						Target: target,
					},
				},
			},
			ScaleTargetRef: autoscalingv2.CrossVersionObjectReference{
				APIVersion: "apps/v1",
				Kind:       "Deployment",
				Name:       name,
			},
		},
	}
}

type APNetworkIngressInput struct {
	APName            string
	CustomDomains     []APCustomDomainRequest
	Namespace         string
	PlatformAddresses []APPlatformAddressRequest
	ProjectID         string
	RoutingDomain     string
}

type APPlatformAddressRequest struct {
	ID   string
	Port int32
}

type APCustomDomainRequest struct {
	Domain            string
	ID                string
	PlatformAddressID string
}

var apPublicAddressResourceNameUnsafeCharsPattern = regexp.MustCompile(`[^a-z0-9-]+`)
var apPlatformAddressHostUnsafeCharsPattern = regexp.MustCompile(`[^a-z0-9-]+`)

func RenderAPPublicIngresses(input APNetworkIngressInput) ([]*networkingv1.Ingress, error) {
	apName := strings.TrimSpace(input.APName)
	namespace := strings.TrimSpace(input.Namespace)
	projectID := strings.TrimSpace(input.ProjectID)
	routingDomain := strings.TrimSpace(input.RoutingDomain)
	if apName == "" || namespace == "" || projectID == "" {
		return nil, fmt.Errorf("apName, namespace, and projectID are required")
	}

	platformsByID := make(map[string]APPlatformAddressRequest, len(input.PlatformAddresses))
	ingresses := make([]*networkingv1.Ingress, 0, len(input.PlatformAddresses)+len(input.CustomDomains))
	for _, address := range input.PlatformAddresses {
		id := strings.TrimSpace(address.ID)
		if id == "" {
			continue
		}
		port := address.Port
		if port <= 0 {
			port = 80
		}
		platformsByID[id] = APPlatformAddressRequest{ID: id, Port: port}
		host := PlatformAddressHost(namespace, apName, id, routingDomain)
		if host == "" {
			continue
		}
		ingress, err := RenderAPPublicIngress(APPublicIngressInput{
			APName:       apName,
			Host:         host,
			Namespace:    namespace,
			ProjectID:    projectID,
			PublicID:     id,
			PublicKind:   "platform",
			ResourceName: APPublicAddressResourceName(apName, id),
			ServicePort:  port,
		})
		if err != nil {
			return nil, err
		}
		ingresses = append(ingresses, ingress)
	}

	for _, customDomain := range input.CustomDomains {
		id := strings.TrimSpace(customDomain.ID)
		host := strings.Trim(strings.ToLower(strings.TrimSpace(customDomain.Domain)), ".")
		platformID := strings.TrimSpace(customDomain.PlatformAddressID)
		platform, ok := platformsByID[platformID]
		if id == "" || host == "" || !ok {
			continue
		}
		ingress, err := RenderAPPublicIngress(APPublicIngressInput{
			APName:       apName,
			Host:         host,
			Namespace:    namespace,
			ProjectID:    projectID,
			PublicID:     id,
			PublicKind:   "custom-domain",
			ResourceName: APPublicAddressResourceName(apName, id),
			ServicePort:  platform.Port,
		})
		if err != nil {
			return nil, err
		}
		ingresses = append(ingresses, ingress)
	}

	return ingresses, nil
}

func APPublicAddressResourceName(apName, publicID string) string {
	name := strings.ToLower(strings.TrimSpace(apName)) + "-" + strings.ReplaceAll(strings.ToLower(strings.TrimSpace(publicID)), "_", "-")
	name = apPublicAddressResourceNameUnsafeCharsPattern.ReplaceAllString(name, "-")
	name = strings.Trim(name, "-")
	if len(name) > 63 {
		name = strings.TrimRight(name[:63], "-")
	}
	if name == "" {
		return "ap-public-address"
	}
	return name
}

func PlatformAddressHost(namespace string, name string, id string, domain string) string {
	namespace = strings.TrimSpace(namespace)
	name = strings.TrimSpace(name)
	id = strings.TrimSpace(id)
	domain = strings.TrimSpace(domain)
	if namespace == "" || name == "" || id == "" || domain == "" {
		return ""
	}
	sum := sha256.Sum256([]byte(fmt.Sprintf("%s/%s/%s", namespace, name, id)))
	return fmt.Sprintf("%s-%x.%s", platformAddressHostPrefix(name), sum[:5], domain)
}

func platformAddressHostPrefix(name string) string {
	prefix := strings.ToLower(strings.TrimSpace(name))
	prefix = apPlatformAddressHostUnsafeCharsPattern.ReplaceAllString(prefix, "-")
	prefix = strings.Trim(prefix, "-")
	if len(prefix) > 52 {
		prefix = prefix[:52]
		prefix = strings.TrimRight(prefix, "-")
	}
	if prefix == "" {
		return "ap"
	}
	return prefix
}

type APPublicIngressInput struct {
	APName       string
	Host         string
	Namespace    string
	ProjectID    string
	PublicID     string
	PublicKind   string
	ServicePort  int32
	ResourceName string
}

func RenderAPPublicIngress(input APPublicIngressInput) (*networkingv1.Ingress, error) {
	apName := strings.TrimSpace(input.APName)
	namespace := strings.TrimSpace(input.Namespace)
	projectID := strings.TrimSpace(input.ProjectID)
	host := strings.TrimSpace(input.Host)
	resourceName := strings.TrimSpace(input.ResourceName)
	if resourceName == "" {
		resourceName = dns1035SupportName(apName, "ap", "-ingress", 63)
	}
	if apName == "" || namespace == "" || projectID == "" || host == "" {
		return nil, fmt.Errorf("apName, namespace, projectID, and host are required")
	}
	port := input.ServicePort
	if port <= 0 {
		port = 80
	}
	pathType := networkingv1.PathTypePrefix
	labels := mergeStringMap(
		brainLabels(projectID, ResourceKindEntryPointSupport, resourceName),
		map[string]string{
			BrainAppNameLabel:                    apName,
			"brain.io/public-address-id":         strings.TrimSpace(input.PublicID),
			"brain.io/public-address-kind":       strings.TrimSpace(input.PublicKind),
			LaunchpadAppDeployManagerLabel:       apName,
			LaunchpadAppDeployManagerDomainLabel: hostLabelValue(host),
		},
	)
	return &networkingv1.Ingress{
		TypeMeta: metav1.TypeMeta{
			APIVersion: "networking.k8s.io/v1",
			Kind:       "Ingress",
		},
		ObjectMeta: metav1.ObjectMeta{
			Annotations: map[string]string{
				LaunchpadAppDeployManagerDomainHostAnnotation: host,
			},
			Labels:    labels,
			Name:      resourceName,
			Namespace: namespace,
		},
		Spec: networkingv1.IngressSpec{
			Rules: []networkingv1.IngressRule{
				{
					Host: host,
					IngressRuleValue: networkingv1.IngressRuleValue{
						HTTP: &networkingv1.HTTPIngressRuleValue{
							Paths: []networkingv1.HTTPIngressPath{
								{
									Path:     "/",
									PathType: &pathType,
									Backend: networkingv1.IngressBackend{
										Service: &networkingv1.IngressServiceBackend{
											Name: APServiceName(apName),
											Port: networkingv1.ServiceBackendPort{Number: port},
										},
									},
								},
							},
						},
					},
				},
			},
		},
	}, nil
}

func hostLabelValue(host string) string {
	sum := sha256.Sum256([]byte(strings.TrimSpace(host)))
	return fmt.Sprintf("host-%x", sum[:8])
}
