package k8s

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/kubernetes"
	clientcmdapi "k8s.io/client-go/tools/clientcmd/api"

	"sealos/api/middleware"
)

// RolloutOptions holds options for RolloutRestart, mimicking kubectl rollout restart flags.
type RolloutOptions struct {
	// Resource is deployment, statefulset, or daemonset.
	Resource string
	// Name is the resource name (required).
	Name string
	// Namespace. Default from kubeconfig when empty.
	Namespace string
}

// RolloutRestart triggers a rolling restart by patching the pod template with restartedAt annotation.
func RolloutRestart(cfg *clientcmdapi.Config, opts RolloutOptions) ([]byte, error) {
	if opts.Name == "" {
		return nil, fmt.Errorf("name is required")
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

	ctx := context.Background()
	r := strings.ToLower(strings.TrimSpace(opts.Resource))
	restartedAt := time.Now().Format(time.RFC3339)
	patch := fmt.Sprintf(`{"spec":{"template":{"metadata":{"annotations":{"kubectl.kubernetes.io/restartedAt":"%s"}}}}}`, restartedAt)

	switch r {
	case "deployment", "deployments", "deploy":
		dep, err := clientset.AppsV1().Deployments(ns).Patch(ctx, opts.Name, types.StrategicMergePatchType, []byte(patch), metav1.PatchOptions{})
		if err != nil {
			return nil, err
		}
		return json.Marshal(dep)
	case "statefulset", "statefulsets", "sts":
		sts, err := clientset.AppsV1().StatefulSets(ns).Patch(ctx, opts.Name, types.StrategicMergePatchType, []byte(patch), metav1.PatchOptions{})
		if err != nil {
			return nil, err
		}
		return json.Marshal(sts)
	case "daemonset", "daemonsets", "ds":
		ds, err := clientset.AppsV1().DaemonSets(ns).Patch(ctx, opts.Name, types.StrategicMergePatchType, []byte(patch), metav1.PatchOptions{})
		if err != nil {
			return nil, err
		}
		return json.Marshal(ds)
	default:
		return nil, fmt.Errorf("resource %q does not support rollout restart (use deployment, statefulset, or daemonset)", opts.Resource)
	}
}

// RolloutStatusOptions holds options for RolloutStatus.
type RolloutStatusOptions struct {
	Resource  string
	Name      string
	Namespace string
}

// RolloutStatus returns rollout status (replicas, updated, ready, etc.).
func RolloutStatus(cfg *clientcmdapi.Config, opts RolloutStatusOptions) ([]byte, error) {
	if opts.Name == "" {
		return nil, fmt.Errorf("name is required")
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

	ctx := context.Background()
	r := strings.ToLower(strings.TrimSpace(opts.Resource))

	switch r {
	case "deployment", "deployments", "deploy":
		dep, err := clientset.AppsV1().Deployments(ns).Get(ctx, opts.Name, metav1.GetOptions{})
		if err != nil {
			return nil, err
		}
		status := rolloutStatusFromDeployment(dep)
		return json.Marshal(status)
	case "statefulset", "statefulsets", "sts":
		sts, err := clientset.AppsV1().StatefulSets(ns).Get(ctx, opts.Name, metav1.GetOptions{})
		if err != nil {
			return nil, err
		}
		status := rolloutStatusFromStatefulSet(sts)
		return json.Marshal(status)
	case "daemonset", "daemonsets", "ds":
		ds, err := clientset.AppsV1().DaemonSets(ns).Get(ctx, opts.Name, metav1.GetOptions{})
		if err != nil {
			return nil, err
		}
		status := rolloutStatusFromDaemonSet(ds)
		return json.Marshal(status)
	default:
		return nil, fmt.Errorf("resource %q does not support rollout status", opts.Resource)
	}
}

func rolloutStatusFromDeployment(d *appsv1.Deployment) map[string]interface{} {
	replicas := int32(0)
	if d.Spec.Replicas != nil {
		replicas = *d.Spec.Replicas
	}
	return map[string]interface{}{
		"replicas":          replicas,
		"updatedReplicas":   d.Status.UpdatedReplicas,
		"readyReplicas":     d.Status.ReadyReplicas,
		"availableReplicas": d.Status.AvailableReplicas,
		"conditions":        d.Status.Conditions,
	}
}

func rolloutStatusFromStatefulSet(s *appsv1.StatefulSet) map[string]interface{} {
	replicas := int32(0)
	if s.Spec.Replicas != nil {
		replicas = *s.Spec.Replicas
	}
	return map[string]interface{}{
		"replicas":        replicas,
		"updatedReplicas": s.Status.UpdatedReplicas,
		"readyReplicas":   s.Status.ReadyReplicas,
		"currentReplicas": s.Status.CurrentReplicas,
		"conditions":      s.Status.Conditions,
	}
}

func rolloutStatusFromDaemonSet(d *appsv1.DaemonSet) map[string]interface{} {
	return map[string]interface{}{
		"desiredNumberScheduled": d.Status.DesiredNumberScheduled,
		"currentNumberScheduled": d.Status.CurrentNumberScheduled,
		"numberReady":            d.Status.NumberReady,
		"numberAvailable":        d.Status.NumberAvailable,
		"conditions":             d.Status.Conditions,
	}
}
