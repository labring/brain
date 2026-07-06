package k8s

import (
	"bytes"
	"context"
	"strings"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
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

const applyFieldManager = "k8s-apply"

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
	if err := applyTypedObjects(config, objects, implicitNamespace); err != nil {
		return err
	}
	unstructuredObjects, err := runtimeObjectsToUnstructured(filterUntypedObjects(objects))
	if err != nil {
		return err
	}
	return ApplyUnstructured(config, unstructuredObjects, implicitNamespace)
}

func applyTypedObjects(config *rest.Config, objects []runtime.Object, implicitNamespace string) error {
	clientset, err := kubernetes.NewForConfig(config)
	if err != nil {
		return err
	}
	ctx := context.Background()
	for _, object := range objects {
		switch typed := object.(type) {
		case *appsv1.Deployment:
			deployment := typed.DeepCopy()
			ns := resolvedNamespace(deployment.Namespace, implicitNamespace)
			deployment.Namespace = ns
			deployment.TypeMeta = metav1.TypeMeta{APIVersion: "apps/v1", Kind: "Deployment"}
			existing, err := clientset.AppsV1().Deployments(ns).Get(ctx, deployment.Name, metav1.GetOptions{})
			if apierrors.IsNotFound(err) {
				if _, err := clientset.AppsV1().Deployments(ns).Create(ctx, deployment, metav1.CreateOptions{}); err != nil {
					return err
				}
				continue
			}
			if err != nil {
				return err
			}
			deployment.ResourceVersion = existing.ResourceVersion
			if _, err := clientset.AppsV1().Deployments(ns).Update(ctx, deployment, metav1.UpdateOptions{}); err != nil {
				return err
			}
		case *appsv1.StatefulSet:
			statefulSet := typed.DeepCopy()
			ns := resolvedNamespace(statefulSet.Namespace, implicitNamespace)
			statefulSet.Namespace = ns
			statefulSet.TypeMeta = metav1.TypeMeta{APIVersion: "apps/v1", Kind: "StatefulSet"}
			existing, err := clientset.AppsV1().StatefulSets(ns).Get(ctx, statefulSet.Name, metav1.GetOptions{})
			if apierrors.IsNotFound(err) {
				if _, err := clientset.AppsV1().StatefulSets(ns).Create(ctx, statefulSet, metav1.CreateOptions{}); err != nil {
					return err
				}
				continue
			}
			if err != nil {
				return err
			}
			statefulSet.ResourceVersion = existing.ResourceVersion
			if _, err := clientset.AppsV1().StatefulSets(ns).Update(ctx, statefulSet, metav1.UpdateOptions{}); err != nil {
				return err
			}
		case *corev1.Service:
			service := typed.DeepCopy()
			ns := resolvedNamespace(service.Namespace, implicitNamespace)
			service.Namespace = ns
			service.TypeMeta = metav1.TypeMeta{APIVersion: "v1", Kind: "Service"}
			existing, err := clientset.CoreV1().Services(ns).Get(ctx, service.Name, metav1.GetOptions{})
			if apierrors.IsNotFound(err) {
				if _, err := clientset.CoreV1().Services(ns).Create(ctx, service, metav1.CreateOptions{}); err != nil {
					return err
				}
				continue
			}
			if err != nil {
				return err
			}
			service.ResourceVersion = existing.ResourceVersion
			if service.Spec.ClusterIP == "" {
				service.Spec.ClusterIP = existing.Spec.ClusterIP
			}
			if len(service.Spec.ClusterIPs) == 0 {
				service.Spec.ClusterIPs = existing.Spec.ClusterIPs
			}
			if service.Spec.IPFamilies == nil {
				service.Spec.IPFamilies = existing.Spec.IPFamilies
			}
			if service.Spec.IPFamilyPolicy == nil {
				service.Spec.IPFamilyPolicy = existing.Spec.IPFamilyPolicy
			}
			if _, err := clientset.CoreV1().Services(ns).Update(ctx, service, metav1.UpdateOptions{}); err != nil {
				return err
			}
		}
	}
	return nil
}

func resolvedNamespace(namespace, implicitNamespace string) string {
	ns := strings.TrimSpace(namespace)
	if ns == "" {
		ns = strings.TrimSpace(implicitNamespace)
	}
	if ns == "" {
		ns = "default"
	}
	return ns
}

func filterUntypedObjects(objects []runtime.Object) []runtime.Object {
	filtered := make([]runtime.Object, 0, len(objects))
	for _, object := range objects {
		switch object.(type) {
		case *appsv1.Deployment, *appsv1.StatefulSet, *corev1.Service:
			continue
		default:
			filtered = append(filtered, object)
		}
	}
	return filtered
}

func runtimeObjectsToUnstructured(objects []runtime.Object) ([]*unstructured.Unstructured, error) {
	unstructuredObjects := make([]*unstructured.Unstructured, 0, len(objects))
	for _, object := range objects {
		if object == nil {
			continue
		}
		m, err := runtime.DefaultUnstructuredConverter.ToUnstructured(object)
		if err != nil {
			return nil, err
		}
		unstructuredObject := &unstructured.Unstructured{Object: m}
		if gvk := object.GetObjectKind().GroupVersionKind(); !gvk.Empty() {
			unstructuredObject.SetGroupVersionKind(gvk)
		}
		unstructuredObjects = append(unstructuredObjects, unstructuredObject)
	}
	return unstructuredObjects, nil
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
