package db

import (
	"context"

	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
)

var accessHealthDBGVR = schema.GroupVersionResource{
	Group:    "example.crossplane.io",
	Version:  "v1",
	Resource: "dbs",
}

type KubernetesAccessHealthStore struct {
	dynamic dynamic.Interface
	core    kubernetes.Interface
}

func NewKubernetesAccessHealthStore(restConfig *rest.Config) (*KubernetesAccessHealthStore, error) {
	dyn, err := dynamic.NewForConfig(restConfig)
	if err != nil {
		return nil, err
	}
	core, err := kubernetes.NewForConfig(restConfig)
	if err != nil {
		return nil, err
	}
	return &KubernetesAccessHealthStore{dynamic: dyn, core: core}, nil
}

func (s *KubernetesAccessHealthStore) GetDB(ctx context.Context, namespace, name string) (*unstructured.Unstructured, error) {
	obj, err := s.dynamic.Resource(accessHealthDBGVR).Namespace(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		if apierrors.IsNotFound(err) {
			return nil, ErrAccessHealthDBNotFound
		}
		return nil, err
	}
	return obj, nil
}

func (s *KubernetesAccessHealthStore) GetSecret(ctx context.Context, namespace, name string) (*corev1.Secret, error) {
	secret, err := s.core.CoreV1().Secrets(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		if apierrors.IsNotFound(err) {
			return nil, ErrAccessHealthSecretMissing
		}
		return nil, err
	}
	return secret, nil
}

var consoleInstanceSetGVRs = []schema.GroupVersionResource{
	{Group: "workloads.kubeblocks.io", Version: "v1", Resource: "instancesets"},
	{Group: "workloads.kubeblocks.io", Version: "v1alpha1", Resource: "instancesets"},
}

// GetInstanceSetMembers reads status.membersStatus from the KubeBlocks InstanceSet
// named "<dbName>-<component>", trying each supported API version.
func (s *KubernetesAccessHealthStore) GetInstanceSetMembers(ctx context.Context, namespace, dbName, component string) ([]InstanceSetMember, error) {
	name := dbName + "-" + component
	var lastErr error
	for _, gvr := range consoleInstanceSetGVRs {
		obj, err := s.dynamic.Resource(gvr).Namespace(namespace).Get(ctx, name, metav1.GetOptions{})
		if err != nil {
			lastErr = err
			continue
		}
		raw, _, _ := unstructured.NestedSlice(obj.Object, "status", "membersStatus")
		members := make([]InstanceSetMember, 0, len(raw))
		for _, item := range raw {
			m, ok := item.(map[string]any)
			if !ok {
				continue
			}
			pod, _, _ := unstructured.NestedString(m, "podName")
			leader, _, _ := unstructured.NestedBool(m, "role", "isLeader")
			members = append(members, InstanceSetMember{PodName: pod, IsLeader: leader})
		}
		return members, nil
	}
	return nil, lastErr
}
