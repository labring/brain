package k8s

import (
	"testing"

	appsv1 "k8s.io/api/apps/v1"
	autoscalingv2 "k8s.io/api/autoscaling/v2"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
)

func TestRuntimeObjectsToUnstructuredPreservesServiceGVK(t *testing.T) {
	service := &corev1.Service{
		TypeMeta: metav1.TypeMeta{
			APIVersion: "v1",
			Kind:       "Service",
		},
		ObjectMeta: metav1.ObjectMeta{
			Name:      "db-export",
			Namespace: "ns-a",
		},
	}

	objects, err := runtimeObjectsToUnstructured([]runtime.Object{service})
	if err != nil {
		t.Fatalf("runtimeObjectsToUnstructured returned error: %v", err)
	}
	if len(objects) != 1 {
		t.Fatalf("expected 1 object, got %d", len(objects))
	}
	gvk := objects[0].GroupVersionKind()
	if gvk.Group != "" || gvk.Version != "v1" || gvk.Kind != "Service" {
		t.Fatalf("expected v1 Service GVK, got %s", gvk.String())
	}
}

func TestFilterUntypedObjectsSkipsTypedWorkloadsAndService(t *testing.T) {
	deployment := &appsv1.Deployment{
		TypeMeta: metav1.TypeMeta{APIVersion: "apps/v1", Kind: "Deployment"},
		ObjectMeta: metav1.ObjectMeta{
			Name:      "app",
			Namespace: "ns-a",
		},
	}
	statefulSet := &appsv1.StatefulSet{
		TypeMeta: metav1.TypeMeta{APIVersion: "apps/v1", Kind: "StatefulSet"},
		ObjectMeta: metav1.ObjectMeta{
			Name:      "app",
			Namespace: "ns-a",
		},
	}
	service := &corev1.Service{
		TypeMeta: metav1.TypeMeta{APIVersion: "v1", Kind: "Service"},
		ObjectMeta: metav1.ObjectMeta{
			Name:      "app",
			Namespace: "ns-a",
		},
	}
	hpa := &autoscalingv2.HorizontalPodAutoscaler{
		TypeMeta: metav1.TypeMeta{APIVersion: "autoscaling/v2", Kind: "HorizontalPodAutoscaler"},
		ObjectMeta: metav1.ObjectMeta{
			Name:      "app",
			Namespace: "ns-a",
		},
	}

	filtered := filterUntypedObjects([]runtime.Object{deployment, statefulSet, service, hpa})
	if len(filtered) != 1 {
		t.Fatalf("expected only HPA to remain, got %d objects", len(filtered))
	}
	if filtered[0] != hpa {
		t.Fatalf("expected HPA to remain after filtering")
	}
}
