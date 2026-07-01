package k8s

import (
	"context"
	"encoding/json"
	"fmt"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/client-go/discovery/cached/memory"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/kubernetes"
	clientcmdapi "k8s.io/client-go/tools/clientcmd/api"

	"sealos/api/middleware"
)

// DeleteOptions holds options for Delete, mimicking kubectl delete flags.
type DeleteOptions struct {
	// Resource is the resource type (e.g. "pods", "po", "deployments").
	Resource string
	// Name is the resource name. If empty, deletes all matching LabelSelector/FieldSelector.
	Name string
	// Namespace limits to this namespace. Default from kubeconfig when empty.
	Namespace string
	// LabelSelector deletes only resources matching this selector.
	LabelSelector string
	// FieldSelector deletes only resources matching this selector.
	FieldSelector string
	// All when true with Name empty, deletes all resources of the type in namespace.
	All bool
}

// Delete deletes Kubernetes resources. Returns deleted object(s) as JSON.
func Delete(cfg *clientcmdapi.Config, opts DeleteOptions) ([]byte, error) {
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
	discoveryClient := memory.NewMemCacheClient(clientset.Discovery())

	gvr, namespaced, err := resolveResource(discoveryClient, opts.Resource)
	if err != nil {
		return nil, err
	}

	ctx := context.Background()
	delOpts := metav1.DeleteOptions{}

	ns := resolvedCtx.Namespace
	if namespaced {
		ns = resolvedCtx.Namespace
	} else {
		ns = ""
	}

	if opts.Name != "" {
		err = client.Resource(gvr).Namespace(ns).Delete(ctx, opts.Name, delOpts)
		if err != nil {
			return nil, err
		}
		return []byte(`{"status":"deleted"}`), nil
	}

	listOpts := metav1.ListOptions{
		LabelSelector: opts.LabelSelector,
		FieldSelector: opts.FieldSelector,
	}
	if !opts.All && opts.LabelSelector == "" && opts.FieldSelector == "" {
		return nil, fmt.Errorf("must specify --all, --selector, or resource name")
	}

	var list *unstructured.UnstructuredList
	if namespaced {
		list, err = client.Resource(gvr).Namespace(ns).List(ctx, listOpts)
	} else {
		list, err = client.Resource(gvr).List(ctx, listOpts)
	}
	if err != nil {
		return nil, err
	}

	for _, item := range list.Items {
		name := item.GetName()
		if err := client.Resource(gvr).Namespace(ns).Delete(ctx, name, delOpts); err != nil {
			return nil, err
		}
	}
	return json.Marshal(map[string]interface{}{"deleted": len(list.Items)})
}
