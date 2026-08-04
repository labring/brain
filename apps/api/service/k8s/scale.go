package k8s

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
	clientcmdapi "k8s.io/client-go/tools/clientcmd/api"

	"sealos/api/middleware"
)

// ScaleOptions holds options for Scale, mimicking kubectl scale flags.
type ScaleOptions struct {
	// Resource is the scalable resource type (e.g. "deployment", "deploy", "replicaset", "rs", "statefulset", "sts").
	Resource string
	// Name is the resource name (required).
	Name string
	// Namespace. Default from kubeconfig when empty.
	Namespace string
	// Replicas is the desired replica count (required).
	Replicas int32
	// CurrentReplicas if set, ensures scale only when current matches (--current-replicas).
	CurrentReplicas int32
}

// Scale scales a deployment/replicaset/statefulset. Returns the updated object as JSON.
func Scale(cfg *clientcmdapi.Config, opts ScaleOptions) ([]byte, error) {
	if opts.Name == "" {
		return nil, fmt.Errorf("name is required")
	}
	if opts.Replicas < 0 {
		return nil, fmt.Errorf("replicas must be >= 0")
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
	_, namespaced, err := sharedDiscovery.resolveResource(
		resolvedCtx.RestConfig.Host, clientset.Discovery(), opts.Resource)
	if err != nil {
		return nil, err
	}

	ns := resolvedCtx.Namespace
	if namespaced {
		ns = resolvedCtx.Namespace
	} else {
		ns = ""
	}

	ctx := context.Background()
	r := strings.ToLower(strings.TrimSpace(opts.Resource))

	switch r {
	case "deployment", "deployments", "deploy":
		return scaleDeployment(ctx, clientset, ns, opts)
	case "replicaset", "replicasets", "rs":
		return scaleReplicaSet(ctx, clientset, ns, opts)
	case "statefulset", "statefulsets", "sts":
		return scaleStatefulSet(ctx, clientset, ns, opts)
	default:
		return nil, fmt.Errorf("resource %q does not support scaling (use deployment, replicaset, or statefulset)", opts.Resource)
	}
}

func scaleDeployment(ctx context.Context, c *kubernetes.Clientset, ns string, opts ScaleOptions) ([]byte, error) {
	dep, err := c.AppsV1().Deployments(ns).Get(ctx, opts.Name, metav1.GetOptions{})
	if err != nil {
		return nil, err
	}
	if opts.CurrentReplicas > 0 && dep.Spec.Replicas != nil && *dep.Spec.Replicas != opts.CurrentReplicas {
		return nil, fmt.Errorf("current replicas %d does not match --current-replicas=%d", *dep.Spec.Replicas, opts.CurrentReplicas)
	}
	dep.Spec.Replicas = &opts.Replicas
	updated, err := c.AppsV1().Deployments(ns).Update(ctx, dep, metav1.UpdateOptions{})
	if err != nil {
		return nil, err
	}
	return json.Marshal(updated)
}

func scaleReplicaSet(ctx context.Context, c *kubernetes.Clientset, ns string, opts ScaleOptions) ([]byte, error) {
	rs, err := c.AppsV1().ReplicaSets(ns).Get(ctx, opts.Name, metav1.GetOptions{})
	if err != nil {
		return nil, err
	}
	if opts.CurrentReplicas > 0 && rs.Spec.Replicas != nil && *rs.Spec.Replicas != opts.CurrentReplicas {
		return nil, fmt.Errorf("current replicas %d does not match --current-replicas=%d", *rs.Spec.Replicas, opts.CurrentReplicas)
	}
	rs.Spec.Replicas = &opts.Replicas
	updated, err := c.AppsV1().ReplicaSets(ns).Update(ctx, rs, metav1.UpdateOptions{})
	if err != nil {
		return nil, err
	}
	return json.Marshal(updated)
}

func scaleStatefulSet(ctx context.Context, c *kubernetes.Clientset, ns string, opts ScaleOptions) ([]byte, error) {
	sts, err := c.AppsV1().StatefulSets(ns).Get(ctx, opts.Name, metav1.GetOptions{})
	if err != nil {
		return nil, err
	}
	if opts.CurrentReplicas > 0 && sts.Spec.Replicas != nil && *sts.Spec.Replicas != opts.CurrentReplicas {
		return nil, fmt.Errorf("current replicas %d does not match --current-replicas=%d", *sts.Spec.Replicas, opts.CurrentReplicas)
	}
	sts.Spec.Replicas = &opts.Replicas
	updated, err := c.AppsV1().StatefulSets(ns).Update(ctx, sts, metav1.UpdateOptions{})
	if err != nil {
		return nil, err
	}
	return json.Marshal(updated)
}
