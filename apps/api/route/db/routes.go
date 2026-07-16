package db

import (
	"github.com/danielgtaylor/huma/v2"
)

// Register adds the DB (Database) API routes to the Huma API.
//
// DB is a Brain product resource rendered by the Go API into a KubeBlocks Cluster
// and related Kubernetes support resources.
// The DB spec is the API contract for the KubeBlocks Cluster (PostgreSQL, MySQL, Redis, MongoDB, etc.):
// - engine: database engine (postgresql, mysql, redis, mongodb).
// - replicas: optional replica count (default 1).
// - paused: optional lifecycle flag; true stops DB compute without rewriting replicas.
// - restartRequest: optional non-negative restart counter for declarative KubeBlocks restart requests.
// - quota: resource preset xs|s|m|l (default xs); renderer maps it to CPU/memory/storage.
// - storageSize / cpu* / memory*: optional overrides for quota preset defaults.
// - storageClassName: StorageClass for PVCs; omit to use cluster default.
// - terminationPolicy: optional Delete or WipeOut (default Delete).
// - exposeNodePort: optional; when true, NodePort Service {name}-export with apiserver-assigned nodePort (default false).
// - projectId: Brain Project product id used for brain.io/project-id ownership labels.
func Register(api huma.API) {
	grp := huma.NewGroup(api, "/api/db/v1alpha1")
	registerGet(grp)
	registerConnectionString(grp)
	registerAccessHealth(grp)
	registerAccessObjects(grp)
	registerAccessObject(grp)
	registerAccessColumns(grp)
	registerAccessRows(grp)
	registerAccessExport(grp)
	registerCreate(grp)
	registerBackup(grp)
	registerRestore(grp)
	registerBackupPolicy(grp)
	registerStart(grp)
	registerStop(grp)
	registerRestart(grp)
	registerUpdate(grp)
	registerDelete(grp)
}
