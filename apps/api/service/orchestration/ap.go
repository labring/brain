package orchestration

import (
	"fmt"
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
	Env           []corev1.EnvVar
	Image         string
	Name          string
	Namespace     string
	PrivatePort   int32
	ProjectID     string
	Replicas      int32
	ResourceLimit corev1.ResourceList
	ResourceReq   corev1.ResourceList
}

type APResources struct {
	Deployment *appsv1.Deployment
	HPA        *autoscalingv2.HorizontalPodAutoscaler
	Service    *corev1.Service
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
	replicas := input.Replicas
	if replicas < 1 {
		replicas = 1
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
			Labels:    managerLabels,
			Name:      name,
			Namespace: namespace,
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
							ImagePullPolicy: corev1.PullAlways,
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
			Name:      name + "-service",
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

	return &APResources{
		Deployment: deployment,
		Service:    service,
	}, nil
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
		resourceName = apName + "-ingress"
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
			LaunchpadAppDeployManagerDomainLabel: host,
		},
	)
	return &networkingv1.Ingress{
		TypeMeta: metav1.TypeMeta{
			APIVersion: "networking.k8s.io/v1",
			Kind:       "Ingress",
		},
		ObjectMeta: metav1.ObjectMeta{
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
											Name: apName + "-service",
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
