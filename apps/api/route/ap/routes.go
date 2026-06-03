package ap

import (
	"github.com/danielgtaylor/huma/v2"
)

// Register adds the AP (Application) API routes to the Huma API.
//
// AP is a Brain product resource rendered by the Go API into Kubernetes Deployment,
// Service, optional HPA, and public routing support resources:
// - name: logical instance name used for composed resource naming; defaults to metadata.name if omitted.
// - projectId: Brain Project product id used for brain.io/project-id ownership labels.
// - input: image, network.privatePort, network.platformAddresses, env, probes, imagePullPolicy.
// - resource: replicas, requests, limits (Kubernetes-shaped).
// - paused, restartRequest, ingressAnnotations: lifecycle and Ingress metadata.
func Register(api huma.API) {
	grp := huma.NewGroup(api, "/api/ap/v1alpha1")
	registerGet(grp)
	registerCreate(grp)
	registerUpdate(grp)
	registerDelete(grp)
	registerRestart(grp)
	registerEvents(grp)
}
