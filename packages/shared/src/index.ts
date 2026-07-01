// Public surface of @workspace/shared.
//
// Kubernetes `resource.Quantity` port: parse / compare (cmp) / canonicalize
// (toString) / display (formatForDisplay). Semantics match the Go backend
// (`apps/api`), which uses `k8s.io/apimachinery/pkg/api/resource`. See
// ./vendor/quantities/VENDOR.md for provenance.
// biome-ignore lint/performance/noBarrelFile: package entry point re-exporting the vendored quantity API.
export * from "./vendor/quantities";
