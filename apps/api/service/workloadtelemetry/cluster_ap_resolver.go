package workloadtelemetry

import (
	"context"

	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/dynamic"

	"sealos/api/middleware"
)

var (
	apDeploymentGVR  = schema.GroupVersionResource{Group: "apps", Version: "v1", Resource: "deployments"}
	apStatefulSetGVR = schema.GroupVersionResource{Group: "apps", Version: "v1", Resource: "statefulsets"}
)

// ClusterAPResolver authorizes AP telemetry by reading the workload the metrics
// describe with the *caller's* credentials. A successful GET proves both that the
// workload exists and that Kubernetes RBAC grants the caller access to it — the same
// gate the DB path already gets from ResolveDBEngine. Every failure (not found,
// forbidden, kubeconfig unusable) is collapsed into ErrInvalidTarget so the endpoint
// never distinguishes "exists but forbidden" from "does not exist", i.e. never becomes
// a cross-namespace existence oracle.
type ClusterAPResolver struct{}

func (ClusterAPResolver) AuthorizeAPWorkload(ctx context.Context, auth string, namespace string, name string) error {
	restConfig, _, err := middleware.RestConfigFromAuth(auth)
	if err != nil {
		return ErrInvalidTarget
	}
	dyn, err := dynamic.NewForConfig(restConfig)
	if err != nil {
		return ErrInvalidTarget
	}

	// An AP is backed by either a Deployment or a StatefulSet; a readable one of
	// either kind authorizes the request. Mirror currentAPWorkload: a non-NotFound
	// error on the first read (e.g. Forbidden) is a hard deny, not a reason to probe on.
	if _, err := dyn.Resource(apDeploymentGVR).Namespace(namespace).Get(ctx, name, metav1.GetOptions{}); err == nil {
		return nil
	} else if !apierrors.IsNotFound(err) {
		return ErrInvalidTarget
	}
	if _, err := dyn.Resource(apStatefulSetGVR).Namespace(namespace).Get(ctx, name, metav1.GetOptions{}); err == nil {
		return nil
	}
	return ErrInvalidTarget
}
