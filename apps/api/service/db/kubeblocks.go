package db

import "k8s.io/apimachinery/pkg/runtime/schema"

var kubeBlocksClusterGVR = schema.GroupVersionResource{
	Group:    "apps.kubeblocks.io",
	Version:  "v1alpha1",
	Resource: "clusters",
}
