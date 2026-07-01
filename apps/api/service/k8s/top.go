package k8s

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	clientcmdapi "k8s.io/client-go/tools/clientcmd/api"
	metricsv "k8s.io/metrics/pkg/client/clientset/versioned"

	"sealos/api/middleware"
)

// TopOptions holds options for Top, mimicking kubectl top flags.
type TopOptions struct {
	// Resource is "pods".
	Resource string
	// Name is the specific pod name. Empty lists all pods in the namespace.
	Name string
	// Namespace for pods. Default from kubeconfig when empty.
	Namespace string
	// Containers when true shows container-level metrics for pods.
	Containers bool
}

// Top returns resource usage (CPU/memory) as JSON.
func Top(cfg *clientcmdapi.Config, opts TopOptions) ([]byte, error) {
	resolvedCtx, err := middleware.ResolveContext(cfg, middleware.ResolveOptions{
		Namespace:        opts.Namespace,
		DefaultNamespace: corev1.NamespaceDefault,
	})
	if err != nil {
		return nil, err
	}
	mc, err := metricsv.NewForConfig(resolvedCtx.RestConfig)
	if err != nil {
		return nil, err
	}

	r := strings.ToLower(strings.TrimSpace(opts.Resource))
	if r == "" {
		r = "pods"
	}

	switch r {
	case "pods", "po", "pod":
		return topPods(mc, opts, resolvedCtx.Namespace)
	default:
		return nil, fmt.Errorf("top supports only pods, got %q", opts.Resource)
	}
}

func topPods(mc *metricsv.Clientset, opts TopOptions, ns string) ([]byte, error) {
	if opts.Name != "" {
		pm, err := mc.MetricsV1beta1().PodMetricses(ns).Get(context.Background(), opts.Name, metav1.GetOptions{})
		if err != nil {
			return nil, err
		}
		return json.Marshal(pm)
	}

	list, err := mc.MetricsV1beta1().PodMetricses(ns).List(context.Background(), metav1.ListOptions{})
	if err != nil {
		return nil, err
	}
	return json.Marshal(list)
}
