package k8s

import (
	"context"
	"encoding/json"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/client-go/discovery/cached/memory"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/kubernetes"
	clientcmdapi "k8s.io/client-go/tools/clientcmd/api"

	"sealos/api/middleware"
)

// DescribeOptions holds options for Describe, mimicking kubectl describe flags.
type DescribeOptions struct {
	// Resource is the resource type (e.g. "pods", "po", "deployments").
	Resource string
	// Name is the resource name. If empty, describes all resources of the type.
	Name string
	// Namespace. Default from kubeconfig when empty.
	Namespace string
	// LabelSelector filters by labels.
	LabelSelector string
	// FieldSelector filters by fields.
	FieldSelector string
}

// DescribeResult holds resource info and events (kubectl describe output).
type DescribeResult struct {
	Resource interface{} `json:"resource"`
	Events   interface{} `json:"events,omitempty"`
}

// Describe retrieves and describes a resource with events. Returns JSON.
func Describe(cfg *clientcmdapi.Config, opts DescribeOptions) ([]byte, error) {
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
	listOpts := metav1.ListOptions{
		LabelSelector: opts.LabelSelector,
		FieldSelector: opts.FieldSelector,
	}

	ns := resolvedCtx.Namespace
	if !namespaced {
		ns = ""
	}

	if opts.Name != "" {
		obj, err := client.Resource(gvr).Namespace(ns).Get(ctx, opts.Name, metav1.GetOptions{})
		if err != nil {
			return nil, err
		}
		result := DescribeResult{Resource: obj.Object}
		if namespaced {
			events, _ := clientset.CoreV1().Events(ns).List(ctx, metav1.ListOptions{
				FieldSelector: "involvedObject.name=" + opts.Name,
			})
			if events != nil {
				result.Events = events.Items
			}
		}
		return json.Marshal(result)
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
	return json.Marshal(list.Object)
}
