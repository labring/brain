package k8s

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/kubernetes"
	clientcmdapi "k8s.io/client-go/tools/clientcmd/api"

	"sealos/api/middleware"
)

// PatchType is the patch strategy (kubectl apply -t).
type PatchType string

const (
	PatchTypeStrategic PatchType = "strategic" // default for native resources
	PatchTypeMerge     PatchType = "merge"
	PatchTypeJSON      PatchType = "json"
)

// PatchOptions holds options for Patch, mimicking kubectl patch flags.
type PatchOptions struct {
	// Resource is the resource type (e.g. "deployment", "deploy").
	Resource string
	// Name is the resource name (required).
	Name string
	// Namespace limits to this namespace. Default from kubeconfig when empty.
	Namespace string
	// PatchType is strategic, merge, or json.
	PatchType PatchType
	// Patch is the patch body (JSON).
	Patch []byte
}

// Patch patches a Kubernetes resource. Returns the patched object as JSON.
func Patch(cfg *clientcmdapi.Config, opts PatchOptions) ([]byte, error) {
	if opts.Name == "" {
		return nil, fmt.Errorf("name is required")
	}
	if len(opts.Patch) == 0 {
		return nil, fmt.Errorf("patch body is required")
	}

	resolvedCtx, err := middleware.ResolveContext(cfg, middleware.ResolveOptions{
		Namespace:        opts.Namespace,
		DefaultNamespace: corev1.NamespaceDefault,
	})
	if err != nil {
		return nil, err
	}
	client, err := dynamic.NewForConfig(resolvedCtx.RestConfig)
	if err != nil {
		return nil, err
	}
	clientset, err := kubernetes.NewForConfig(resolvedCtx.RestConfig)
	if err != nil {
		return nil, err
	}
	gvr, namespaced, err := sharedDiscovery.resolveResource(
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

	pt := types.MergePatchType
	switch strings.ToLower(string(opts.PatchType)) {
	case "strategic":
		pt = types.StrategicMergePatchType
	case "merge":
		pt = types.MergePatchType
	case "json":
		pt = types.JSONPatchType
	}

	ctx := context.Background()
	obj, err := client.Resource(gvr).Namespace(ns).Patch(ctx, opts.Name, pt, opts.Patch, metav1.PatchOptions{})
	if err != nil {
		return nil, err
	}
	return json.Marshal(obj.Object)
}
