package entrypoint

import "github.com/danielgtaylor/huma/v2"

// Register adds the EntryPoint API routes to the Huma API.
//
// EntryPoint is a product-facing view derived from AP public routing support
// resources such as Ingress and Certificate.
func Register(api huma.API) {
	grp := huma.NewGroup(api, "/api/entrypoint/v1alpha1")
	registerGet(grp)
}
