package k8s

import (
	"bytes"
	"context"
	"strings"

	"k8s.io/apimachinery/pkg/api/meta"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/client-go/discovery/cached/memory"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/restmapper"
	"sigs.k8s.io/yaml"
)

// ApplyYAML applies YAML manifests to the cluster using the given config.
// Supports multi-document YAML (documents separated by "---").
//
// implicitNamespace is used when a namespaced object has an empty metadata.namespace
// (typically the current context namespace from kubeconfig when set at the route layer).
func ApplyYAML(config *rest.Config, yamlBytes []byte, implicitNamespace string) error {
	objects := []*unstructured.Unstructured{}
	docs := splitYAMLDocuments(yamlBytes)
	for _, doc := range docs {
		doc = strings.TrimSpace(doc)
		if doc == "" {
			continue
		}
		var m map[string]interface{}
		if err := yaml.Unmarshal([]byte(doc), &m); err != nil {
			return err
		}
		if len(m) == 0 {
			continue
		}
		objects = append(objects, &unstructured.Unstructured{Object: m})
	}
	return ApplyUnstructured(config, objects, implicitNamespace)
}

func ApplyObjects(config *rest.Config, objects []runtime.Object, implicitNamespace string) error {
	unstructuredObjects := make([]*unstructured.Unstructured, 0, len(objects))
	for _, object := range objects {
		if object == nil {
			continue
		}
		m, err := runtime.DefaultUnstructuredConverter.ToUnstructured(object)
		if err != nil {
			return err
		}
		unstructuredObjects = append(unstructuredObjects, &unstructured.Unstructured{Object: m})
	}
	return ApplyUnstructured(config, unstructuredObjects, implicitNamespace)
}

func ApplyUnstructured(config *rest.Config, objects []*unstructured.Unstructured, implicitNamespace string) error {
	client, err := dynamic.NewForConfig(config)
	if err != nil {
		return err
	}
	clientset, err := kubernetes.NewForConfig(config)
	if err != nil {
		return err
	}
	discoveryClient := memory.NewMemCacheClient(clientset.Discovery())
	mapper := restmapper.NewDeferredDiscoveryRESTMapper(discoveryClient)

	ctx := context.Background()

	for _, obj := range objects {
		if obj == nil || len(obj.Object) == 0 {
			continue
		}
		gvk := obj.GroupVersionKind()
		if gvk.Kind == "" {
			continue
		}
		restMapping, err := mapper.RESTMapping(gvk.GroupKind(), gvk.Version)
		if err != nil {
			return err
		}
		gvr := restMapping.Resource
		var ns string
		if restMapping.Scope.Name() == meta.RESTScopeNameNamespace {
			ns = strings.TrimSpace(obj.GetNamespace())
			if ns == "" {
				ns = strings.TrimSpace(implicitNamespace)
			}
			if ns == "" {
				ns = "default"
			}
			if strings.TrimSpace(obj.GetNamespace()) == "" {
				obj.SetNamespace(ns)
			}
		}
		applyOpts := metav1.ApplyOptions{FieldManager: "k8s-apply"}
		_, err = client.Resource(gvr).Namespace(ns).Apply(ctx, obj.GetName(), obj, applyOpts)
		if err != nil {
			return err
		}
	}
	return nil
}

func splitYAMLDocuments(data []byte) []string {
	parts := bytes.Split(data, []byte("\n---"))
	docs := make([]string, 0, len(parts))
	for _, p := range parts {
		doc := strings.TrimSpace(string(p))
		if doc != "" {
			docs = append(docs, doc)
		}
	}
	return docs
}
