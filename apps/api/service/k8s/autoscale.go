package k8s

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	autoscalingv2 "k8s.io/api/autoscaling/v2"
	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
	clientcmdapi "k8s.io/client-go/tools/clientcmd/api"

	"sealos/api/middleware"
)

// AutoscaleOptions holds options for Autoscale, mimicking kubectl autoscale flags.
type AutoscaleOptions struct {
	// Resource is the scalable resource type (deployment, deploy, replicaset, rs, statefulset, sts).
	Resource string
	// Name is the resource name (required).
	Name string
	// Namespace. Default from kubeconfig when empty.
	Namespace string
	// MinReplicas is the minimum number of pods (optional, default 1).
	MinReplicas int32
	// MaxReplicas is the maximum number of pods (required).
	MaxReplicas int32
	// CPUPercent is the target CPU utilization percentage (optional, default 80).
	CPUPercent int32
}

// Autoscale creates an HPA for the given resource. Returns the created HPA as JSON.
func Autoscale(cfg *clientcmdapi.Config, opts AutoscaleOptions) ([]byte, error) {
	if opts.Name == "" {
		return nil, fmt.Errorf("name is required")
	}
	if opts.MaxReplicas < 1 {
		return nil, fmt.Errorf("max must be >= 1")
	}
	if opts.MinReplicas < 0 {
		return nil, fmt.Errorf("min must be >= 0")
	}
	if opts.MinReplicas > opts.MaxReplicas {
		return nil, fmt.Errorf("min cannot be greater than max")
	}
	if opts.CPUPercent < 1 || opts.CPUPercent > 100 {
		opts.CPUPercent = 80
	}

	resolvedCtx, err := middleware.ResolveContext(cfg, middleware.ResolveOptions{
		Namespace:        opts.Namespace,
		DefaultNamespace: corev1.NamespaceDefault,
	})
	if err != nil {
		return nil, err
	}
	clientset, err := kubernetes.NewForConfig(resolvedCtx.RestConfig)
	if err != nil {
		return nil, err
	}

	ns := resolvedCtx.Namespace

	r := strings.ToLower(strings.TrimSpace(opts.Resource))
	var apiVersion, kind string
	switch r {
	case "deployment", "deployments", "deploy":
		apiVersion, kind = "apps/v1", "Deployment"
	case "replicaset", "replicasets", "rs":
		apiVersion, kind = "apps/v1", "ReplicaSet"
	case "statefulset", "statefulsets", "sts":
		apiVersion, kind = "apps/v1", "StatefulSet"
	default:
		return nil, fmt.Errorf("resource %q does not support autoscaling (use deployment, replicaset, or statefulset)", opts.Resource)
	}

	minReplicas := opts.MinReplicas
	if minReplicas == 0 && opts.MaxReplicas > 0 {
		minReplicas = 1
	}

	hpa := &autoscalingv2.HorizontalPodAutoscaler{
		ObjectMeta: metav1.ObjectMeta{
			Name:      opts.Name,
			Namespace: ns,
		},
		Spec: autoscalingv2.HorizontalPodAutoscalerSpec{
			ScaleTargetRef: autoscalingv2.CrossVersionObjectReference{
				APIVersion: apiVersion,
				Kind:       kind,
				Name:       opts.Name,
			},
			MinReplicas: &minReplicas,
			MaxReplicas: opts.MaxReplicas,
			Metrics: []autoscalingv2.MetricSpec{
				{
					Type: autoscalingv2.ResourceMetricSourceType,
					Resource: &autoscalingv2.ResourceMetricSource{
						Name: "cpu",
						Target: autoscalingv2.MetricTarget{
							Type:               autoscalingv2.UtilizationMetricType,
							AverageUtilization: &opts.CPUPercent,
						},
					},
				},
			},
		},
	}

	ctx := context.Background()
	created, err := clientset.AutoscalingV2().HorizontalPodAutoscalers(ns).Create(ctx, hpa, metav1.CreateOptions{})
	if err != nil {
		if apierrors.IsAlreadyExists(err) {
			existing, getErr := clientset.AutoscalingV2().HorizontalPodAutoscalers(ns).Get(ctx, opts.Name, metav1.GetOptions{})
			if getErr != nil {
				return nil, fmt.Errorf("get existing HPA: %w", getErr)
			}
			existing.Spec = hpa.Spec
			updated, updateErr := clientset.AutoscalingV2().HorizontalPodAutoscalers(ns).Update(ctx, existing, metav1.UpdateOptions{})
			if updateErr != nil {
				return nil, fmt.Errorf("update HPA: %w", updateErr)
			}
			return json.Marshal(updated)
		}
		return nil, fmt.Errorf("create HPA: %w", err)
	}
	return json.Marshal(created)
}
