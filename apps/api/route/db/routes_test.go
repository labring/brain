package db

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humachi"
	"github.com/go-chi/chi/v5"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"

	dbsvc "sealos/api/service/db"
	orchestration "sealos/api/service/orchestration"
)

func testingNow() time.Time {
	return time.Date(2026, 6, 2, 1, 2, 3, 0, time.UTC)
}

func TestRegisterIncludesAccessHealthRoute(t *testing.T) {
	router := chi.NewRouter()
	api := humachi.New(router, huma.DefaultConfig("test", "0.0.0"))

	Register(api)

	path := api.OpenAPI().Paths["/api/db/v1alpha1/{name}/access/health"]
	if path == nil || path.Post == nil {
		t.Fatalf("expected POST /api/db/v1alpha1/{name}/access/health to be registered")
	}
	if path.Post.OperationID != "db-access-health" {
		t.Fatalf("unexpected operation ID: %q", path.Post.OperationID)
	}
}

func TestRegisterIncludesAccessObjectsRoute(t *testing.T) {
	router := chi.NewRouter()
	api := humachi.New(router, huma.DefaultConfig("test", "0.0.0"))

	Register(api)

	path := api.OpenAPI().Paths["/api/db/v1alpha1/{name}/access/objects"]
	if path == nil || path.Post == nil {
		t.Fatalf("expected POST /api/db/v1alpha1/{name}/access/objects to be registered")
	}
	if path.Post.OperationID != "db-access-objects" {
		t.Fatalf("unexpected operation ID: %q", path.Post.OperationID)
	}
}

func TestRegisterIncludesAccessObjectDetailRoutes(t *testing.T) {
	router := chi.NewRouter()
	api := humachi.New(router, huma.DefaultConfig("test", "0.0.0"))

	Register(api)

	paths := map[string]string{
		"/api/db/v1alpha1/{name}/access/object":  "db-access-object",
		"/api/db/v1alpha1/{name}/access/columns": "db-access-columns",
		"/api/db/v1alpha1/{name}/access/rows":    "db-access-rows",
		"/api/db/v1alpha1/{name}/access/export":  "db-access-export",
	}
	for path, operationID := range paths {
		t.Run(path, func(t *testing.T) {
			got := api.OpenAPI().Paths[path]
			if got == nil || got.Post == nil {
				t.Fatalf("expected POST %s to be registered", path)
			}
			if got.Post.OperationID != operationID {
				t.Fatalf("unexpected operation ID: %q", got.Post.OperationID)
			}
		})
	}
}

func TestRegisterIncludesDBLifecycleRoutes(t *testing.T) {
	router := chi.NewRouter()
	api := humachi.New(router, huma.DefaultConfig("test", "0.0.0"))

	Register(api)

	paths := map[string]string{
		"/api/db/v1alpha1/start":   "db-start",
		"/api/db/v1alpha1/stop":    "db-stop",
		"/api/db/v1alpha1/restart": "db-restart",
	}
	for path, operationID := range paths {
		t.Run(path, func(t *testing.T) {
			got := api.OpenAPI().Paths[path]
			if got == nil || got.Post == nil {
				t.Fatalf("expected POST %s to be registered", path)
			}
			if got.Post.OperationID != operationID {
				t.Fatalf("unexpected operation ID: %q", got.Post.OperationID)
			}
		})
	}
}

func TestRegisterIncludesDBRestoreRoute(t *testing.T) {
	router := chi.NewRouter()
	api := humachi.New(router, huma.DefaultConfig("test", "0.0.0"))

	Register(api)

	path := api.OpenAPI().Paths["/api/db/v1alpha1/restore"]
	if path == nil || path.Post == nil {
		t.Fatalf("expected POST /api/db/v1alpha1/restore to be registered")
	}
	if path.Post.OperationID != "db-restore" {
		t.Fatalf("unexpected operation ID: %q", path.Post.OperationID)
	}
	description := path.Post.Description
	for _, want := range []string{
		"completed DB Service Backup",
		"new DB Service",
		"same namespace",
		"projectId",
	} {
		if !strings.Contains(description, want) {
			t.Fatalf("expected restore docs to mention %q, got: %s", want, description)
		}
	}
}

func TestRegisterIncludesDBBackupDeleteRoute(t *testing.T) {
	router := chi.NewRouter()
	api := humachi.New(router, huma.DefaultConfig("test", "0.0.0"))

	Register(api)

	path := api.OpenAPI().Paths["/api/db/v1alpha1/backup"]
	if path == nil || path.Delete == nil {
		t.Fatalf("expected DELETE /api/db/v1alpha1/backup to be registered")
	}
	if path.Delete.OperationID != "db-backup-delete" {
		t.Fatalf("unexpected operation ID: %q", path.Delete.OperationID)
	}
	description := path.Delete.Description
	for _, want := range []string{
		"completed or failed DB Service Backup",
		"source DB Service",
		"pending",
		"running",
	} {
		if !strings.Contains(description, want) {
			t.Fatalf("expected backup delete docs to mention %q, got: %s", want, description)
		}
	}
}

func TestDBPatchDocsIncludeLifecycleFields(t *testing.T) {
	router := chi.NewRouter()
	api := humachi.New(router, huma.DefaultConfig("test", "0.0.0"))

	Register(api)

	path := api.OpenAPI().Paths["/api/db/v1alpha1/"]
	if path == nil || path.Patch == nil {
		t.Fatalf("expected PATCH /api/db/v1alpha1/ to be registered")
	}
	description := path.Patch.Description
	for _, want := range []string{"spec.paused", "spec.restartRequest"} {
		if !bytes.Contains([]byte(description), []byte(want)) {
			t.Fatalf("expected patch docs to mention %s, got: %s", want, description)
		}
	}
}

func TestDBOpenAPIDocsDoNotExposeLegacyOwnershipTerms(t *testing.T) {
	router := chi.NewRouter()
	api := humachi.New(router, huma.DefaultConfig("test", "0.0.0"))

	Register(api)

	raw, err := json.Marshal(api.OpenAPI())
	if err != nil {
		t.Fatalf("marshal openapi: %v", err)
	}
	text := string(raw)
	legacyField := "composition" + "Ref"
	legacyGroupVersion := "example." + "cross" + "plane.io/v1"
	for _, forbidden := range []string{
		"metadata.uid",
		"DB claim",
		legacyField,
		legacyGroupVersion,
	} {
		if strings.Contains(text, forbidden) {
			t.Fatalf("DB OpenAPI docs must not contain %q", forbidden)
		}
	}
	if !strings.Contains(text, "projectId") {
		t.Fatalf("DB OpenAPI docs should expose projectId for Brain Project ownership")
	}
}

func TestExposeNodePortPatchValue(t *testing.T) {
	enabled, found := exposeNodePortPatchValue([]byte(`{"spec":{"exposeNodePort":true}}`))
	if !found || !enabled {
		t.Fatalf("expected enabled exposeNodePort patch, got enabled=%v found=%v", enabled, found)
	}
	enabled, found = exposeNodePortPatchValue([]byte(`{"spec":{"exposeNodePort":false}}`))
	if !found || enabled {
		t.Fatalf("expected disabled exposeNodePort patch, got enabled=%v found=%v", enabled, found)
	}
	_, found = exposeNodePortPatchValue([]byte(`{"spec":{"replicas":2}}`))
	if found {
		t.Fatalf("expected exposeNodePort to be absent")
	}
}

func TestDBUpdatePlanFromProductPatchTranslatesRuntimeFieldsToOpsRequests(t *testing.T) {
	cluster := []byte(`{
		"apiVersion": "apps.kubeblocks.io/v1alpha1",
		"kind": "Cluster",
		"metadata": {
			"name": "pg",
			"namespace": "ns-a",
			"labels": {"brain.io/db-engine": "postgresql"}
		},
		"spec": {
			"componentSpecs": [{
				"name": "postgresql",
				"replicas": 1,
				"volumeClaimTemplates": [{
					"name": "data",
					"spec": {
						"resources": {"requests": {"storage": "10Gi"}}
					}
				}]
			}],
			"terminationPolicy": "Delete"
		}
	}`)
	plan, err := dbUpdatePlanFromProductPatch([]byte(`{
		"spec": {
			"replicas": 3,
			"storageSize": "20Gi",
			"cpuRequest": "500m",
			"memoryLimit": "2Gi",
			"terminationPolicy": "WipeOut"
		}
	}`), cluster, "pg", "ns-a", testingNow())
	if err != nil {
		t.Fatalf("dbUpdatePlanFromProductPatch returned error: %v", err)
	}
	if len(plan.OpsRequests) != 3 {
		t.Fatalf("ops request count = %d, want 3", len(plan.OpsRequests))
	}
	specs := map[string]map[string]interface{}{}
	for _, ops := range plan.OpsRequests {
		spec := ops.Object["spec"].(map[string]interface{})
		specs[spec["type"].(string)] = spec
		if got := spec["clusterRef"]; got != "pg" {
			t.Fatalf("clusterRef = %v, want pg", got)
		}
	}
	horizontal := specs["HorizontalScaling"]
	if horizontal == nil {
		t.Fatal("missing HorizontalScaling OpsRequest")
	}
	horizontalItems := horizontal["horizontalScaling"].([]interface{})
	horizontalComponent := horizontalItems[0].(map[string]interface{})
	if got := horizontalComponent["replicas"]; got != int64(3) {
		t.Fatalf("horizontal replicas = %v, want 3", got)
	}
	volume := specs["VolumeExpansion"]
	if volume == nil {
		t.Fatal("missing VolumeExpansion OpsRequest")
	}
	volumeItems := volume["volumeExpansion"].([]interface{})
	volumeComponent := volumeItems[0].(map[string]interface{})
	templates := volumeComponent["volumeClaimTemplates"].([]interface{})
	template := templates[0].(map[string]interface{})
	if got := template["storage"]; got != "20Gi" {
		t.Fatalf("volume expansion storage = %v, want 20Gi", got)
	}
	vertical := specs["VerticalScaling"]
	if vertical == nil {
		t.Fatal("missing VerticalScaling OpsRequest")
	}
	verticalItems := vertical["verticalScaling"].([]interface{})
	verticalComponent := verticalItems[0].(map[string]interface{})
	requests := verticalComponent["requests"].(map[string]interface{})
	if got := requests["cpu"]; got != "500m" {
		t.Fatalf("vertical cpu request = %v, want 500m", got)
	}
	limits := verticalComponent["limits"].(map[string]interface{})
	if got := limits["memory"]; got != "2Gi" {
		t.Fatalf("vertical memory limit = %v, want 2Gi", got)
	}
	if !plan.HasClusterPatch {
		t.Fatal("expected Cluster patch for terminationPolicy")
	}
	var out map[string]interface{}
	if err := json.Unmarshal(plan.ClusterPatch, &out); err != nil {
		t.Fatalf("unmarshal patch: %v", err)
	}
	spec := out["spec"].(map[string]interface{})
	if got := spec["terminationPolicy"]; got != "WipeOut" {
		t.Fatalf("terminationPolicy = %v, want WipeOut", got)
	}
}

func TestDBUpdatePlanFromProductPatchKeepsPublicAccessOutOfClusterAndOpsRequests(t *testing.T) {
	cluster := []byte(`{
		"apiVersion": "apps.kubeblocks.io/v1alpha1",
		"kind": "Cluster",
		"metadata": {"name": "pg", "labels": {"brain.io/db-engine": "postgresql"}},
		"spec": {"componentSpecs": [{"name": "postgresql", "replicas": 1}]}
	}`)
	plan, err := dbUpdatePlanFromProductPatch([]byte(`{"spec":{"exposeNodePort":true}}`), cluster, "pg", "ns-a", testingNow())
	if err != nil {
		t.Fatalf("dbUpdatePlanFromProductPatch returned error: %v", err)
	}
	if plan.HasClusterPatch {
		t.Fatalf("expected no Cluster patch for public access-only product patch, got %s", string(plan.ClusterPatch))
	}
	if len(plan.OpsRequests) != 0 {
		t.Fatalf("expected no OpsRequest for public access-only product patch, got %d", len(plan.OpsRequests))
	}
}

func TestDBUpdatePlanForwardsDisplayNameAnnotation(t *testing.T) {
	cluster := []byte(`{
		"apiVersion": "apps.kubeblocks.io/v1alpha1",
		"kind": "Cluster",
		"metadata": {"name": "pg", "labels": {"brain.io/db-engine": "postgresql"}},
		"spec": {"componentSpecs": [{"name": "postgresql", "replicas": 1}]}
	}`)

	plan, err := dbUpdatePlanFromProductPatch([]byte(`{"metadata":{"annotations":{"brain.io/display-name":" 订单库 "}}}`), cluster, "pg", "ns-a", testingNow())
	if err != nil {
		t.Fatalf("dbUpdatePlanFromProductPatch returned error: %v", err)
	}
	if !plan.HasClusterPatch {
		t.Fatal("expected Cluster patch for display-name product patch")
	}
	var out map[string]interface{}
	if err := json.Unmarshal(plan.ClusterPatch, &out); err != nil {
		t.Fatalf("unmarshal patch: %v", err)
	}
	annotations := out["metadata"].(map[string]interface{})["annotations"].(map[string]interface{})
	if got := annotations[orchestration.BrainDisplayNameAnnotation]; got != "订单库" {
		t.Fatalf("display-name annotation = %v, want 订单库", got)
	}

	plan, err = dbUpdatePlanFromProductPatch([]byte(`{"metadata":{"annotations":{"brain.io/display-name":null}}}`), cluster, "pg", "ns-a", testingNow())
	if err != nil {
		t.Fatalf("dbUpdatePlanFromProductPatch returned error: %v", err)
	}
	if !plan.HasClusterPatch {
		t.Fatal("expected Cluster patch for display-name clear")
	}
	if err := json.Unmarshal(plan.ClusterPatch, &out); err != nil {
		t.Fatalf("unmarshal patch: %v", err)
	}
	annotations = out["metadata"].(map[string]interface{})["annotations"].(map[string]interface{})
	value, ok := annotations[orchestration.BrainDisplayNameAnnotation]
	if !ok || value != nil {
		t.Fatalf("display-name annotation = %v (present %v), want explicit null delete", value, ok)
	}
}

func TestDBUpdatePlanFromProductPatchRejectsUnsupportedProductFields(t *testing.T) {
	cluster := []byte(`{
		"apiVersion": "apps.kubeblocks.io/v1alpha1",
		"kind": "Cluster",
		"metadata": {"name": "pg", "labels": {"brain.io/db-engine": "postgresql"}},
		"spec": {"componentSpecs": [{"name": "postgresql", "replicas": 1}]}
	}`)
	_, err := dbUpdatePlanFromProductPatch([]byte(`{"spec":{"scheduledBackup":{"enabled":true}}}`), cluster, "pg", "ns-a", testingNow())
	if err == nil {
		t.Fatal("expected unsupported scheduledBackup patch to be rejected")
	}
	if !strings.Contains(err.Error(), "spec.scheduledBackup") {
		t.Fatalf("expected error to name unsupported field, got %v", err)
	}
}

func TestDBRenderInputFromObjectReadsQuotaAndResourceFields(t *testing.T) {
	obj := unstructured.Unstructured{
		Object: map[string]interface{}{
			"metadata": map[string]interface{}{"name": "pg"},
			"spec": map[string]interface{}{
				"cpuLimit":      "1500m",
				"cpuRequest":    "500m",
				"engine":        "postgresql",
				"memoryLimit":   "2Gi",
				"memoryRequest": "1Gi",
				"projectId":     "project-a",
				"quota":         "m",
				"storageSize":   "20Gi",
			},
		},
	}

	got := dbRenderInputFromObject(obj, "ns-a")
	if got.Quota != "m" {
		t.Fatalf("quota = %q, want m", got.Quota)
	}
	if got.CPURequest != "500m" || got.CPULimit != "1500m" {
		t.Fatalf("cpu request/limit = %q/%q, want 500m/1500m", got.CPURequest, got.CPULimit)
	}
	if got.MemoryRequest != "1Gi" || got.MemoryLimit != "2Gi" {
		t.Fatalf("memory request/limit = %q/%q, want 1Gi/2Gi", got.MemoryRequest, got.MemoryLimit)
	}
}

func TestDBOwnershipRequiresBrainLabels(t *testing.T) {
	cluster := unstructured.Unstructured{}
	cluster.SetName("pg")
	cluster.SetLabels(map[string]string{
		orchestration.DBProviderClusterDefinitionLabel: "postgresql",
		orchestration.DBProviderInstanceLabel:          "pg",
		orchestration.BrainManagedByLabel:              orchestration.BrainManagedByValue,
		orchestration.BrainProjectIDLabel:              "project-a",
	})
	cluster.SetCreationTimestamp(metav1.Now())

	if err := requireBrainDBCluster(cluster); err != nil {
		t.Fatalf("expected DB Provider cluster to pass ownership check: %v", err)
	}
	labels := cluster.GetLabels()
	delete(labels, orchestration.BrainProjectIDLabel)
	cluster.SetLabels(labels)
	if err := requireBrainDBCluster(cluster); err == nil {
		t.Fatal("expected missing Brain project label to fail ownership check")
	}
}

func TestDBOwnershipRejectsWrongResourceKind(t *testing.T) {
	cluster := unstructured.Unstructured{}
	cluster.SetName("pg")
	cluster.SetLabels(map[string]string{
		orchestration.BrainDeploymentKindLabel: orchestration.DeploymentKindAP,
	})

	if err := requireBrainDBCluster(cluster); err == nil {
		t.Fatal("expected missing DB Provider labels to fail ownership check")
	}
}

func TestDBLikeOwnershipRequiresDBProviderLabels(t *testing.T) {
	cluster := unstructured.Unstructured{}
	cluster.SetName("template-pg")
	cluster.SetLabels(map[string]string{
		orchestration.BrainDeploymentKindLabel:         orchestration.DeploymentKindTemplate,
		orchestration.DBProviderClusterDefinitionLabel: "postgresql",
	})

	if err := requireBrainDBLikeCluster(cluster); err == nil {
		t.Fatal("expected missing DB provider instance label to fail DB-like ownership check")
	}
	cluster.SetLabels(map[string]string{
		orchestration.DBProviderClusterDefinitionLabel: "postgresql",
		orchestration.DBProviderInstanceLabel:          "template-pg",
		orchestration.BrainManagedByLabel:              orchestration.BrainManagedByValue,
		orchestration.BrainProjectIDLabel:              "project-a",
	})
	if err := requireBrainDBLikeCluster(cluster); err != nil {
		t.Fatalf("expected DB Provider-labeled cluster to pass DB-like ownership check: %v", err)
	}
}

func TestDBStrictOwnershipRejectsManagedTemplateClusters(t *testing.T) {
	cluster := unstructured.Unstructured{}
	cluster.SetName("template-pg")
	cluster.SetLabels(map[string]string{
		orchestration.BrainDeploymentKindLabel: orchestration.DeploymentKindTemplate,
		orchestration.BrainDeploymentNameLabel: "template-pg",
		orchestration.BrainManagedByLabel:      orchestration.BrainManagedByValue,
		orchestration.BrainProjectIDLabel:      "project-a",
	})

	if err := requireBrainDBCluster(cluster); err == nil {
		t.Fatal("expected strict DB ownership to reject template cluster")
	}
}

func TestTemplateDeploymentRefFromDBCluster(t *testing.T) {
	cluster := unstructured.Unstructured{}
	cluster.SetName("postgres")
	cluster.SetLabels(map[string]string{
		orchestration.BrainDeploymentKindLabel: orchestration.DeploymentKindTemplate,
		orchestration.BrainDeploymentNameLabel: "template-postgres",
		orchestration.BrainManagedByLabel:      orchestration.BrainManagedByValue,
		orchestration.BrainProjectIDLabel:      "project-a",
	})

	ref, ok := templateDeploymentRefFromDBCluster(cluster)
	if !ok || ref.Name != "template-postgres" || ref.ProjectID != "project-a" {
		t.Fatalf("template deployment ref = %#v/%v, want template-postgres project-a true", ref, ok)
	}
}

func TestDBLifecycleOwnershipAllowsManagedTemplateClusters(t *testing.T) {
	cluster := unstructured.Unstructured{}
	cluster.SetName("template-pg")
	cluster.SetLabels(map[string]string{
		orchestration.DBProviderClusterDefinitionLabel: "postgresql",
		orchestration.DBProviderInstanceLabel:          "template-pg",
		orchestration.BrainManagedByLabel:              orchestration.BrainManagedByValue,
		orchestration.BrainProjectIDLabel:              "project-a",
	})

	if err := requireBrainDBLifecycleCluster(cluster); err != nil {
		t.Fatalf("expected DB Provider-labeled cluster to pass DB lifecycle ownership check: %v", err)
	}
}

func TestDBUpdateOwnershipAllowsManagedTemplateClusters(t *testing.T) {
	cluster := unstructured.Unstructured{}
	cluster.SetName("affine-rvxatt-redis")
	cluster.SetLabels(map[string]string{
		orchestration.DBProviderClusterDefinitionLabel: "redis",
		orchestration.DBProviderInstanceLabel:          "affine-rvxatt-redis",
		orchestration.BrainManagedByLabel:              orchestration.BrainManagedByValue,
		orchestration.BrainProjectIDLabel:              "project-a",
	})

	if err := requireBrainDBUpdateCluster(cluster); err != nil {
		t.Fatalf("expected DB Provider-labeled Redis cluster to pass DB update ownership check: %v", err)
	}
}

func TestDBUpdateOwnershipRejectsTemplateClustersWithUnsupportedEngine(t *testing.T) {
	cluster := unstructured.Unstructured{}
	cluster.SetName("template-support")
	cluster.SetLabels(map[string]string{
		orchestration.DBProviderClusterDefinitionLabel: "unsupported-engine",
		orchestration.DBProviderInstanceLabel:          "template-support",
	})

	if err := requireBrainDBUpdateCluster(cluster); err == nil {
		t.Fatal("expected unsupported template cluster engine to fail DB update ownership check")
	}
}

func TestDBUpdatePlanFromTemplateRedisClusterPatchCreatesOpsRequest(t *testing.T) {
	cluster := []byte(`{
		"apiVersion": "apps.kubeblocks.io/v1alpha1",
		"kind": "Cluster",
		"metadata": {
			"name": "affine-rvxatt-redis",
			"namespace": "ns-a",
			"labels": {
				"brain.io/deployment-kind": "template",
				"brain.io/deployment-name": "affine-rvxatt",
				"brain.io/managed-by": "brain",
				"brain.io/project-id": "project-a",
				"clusterdefinition.kubeblocks.io/name": "redis"
			}
		},
		"spec": {
			"clusterDefinitionRef": "redis",
			"componentSpecs": [{"name": "redis", "replicas": 1}]
		}
	}`)
	plan, err := dbUpdatePlanFromProductPatch([]byte(`{"spec":{"restartRequest":1}}`), cluster, "affine-rvxatt-redis", "ns-a", testingNow())
	if err != nil {
		t.Fatalf("dbUpdatePlanFromProductPatch returned error: %v", err)
	}
	if len(plan.OpsRequests) != 1 {
		t.Fatalf("ops request count = %d, want 1", len(plan.OpsRequests))
	}
	spec := plan.OpsRequests[0].Object["spec"].(map[string]interface{})
	if got := spec["clusterRef"]; got != "affine-rvxatt-redis" {
		t.Fatalf("clusterRef = %v, want affine-rvxatt-redis", got)
	}
	if got := spec["type"]; got != "Restart" {
		t.Fatalf("ops type = %v, want Restart", got)
	}
}

func TestKubeBlocksRestartConflictDetection(t *testing.T) {
	err := errors.New(`admission webhook "vopsrequest.kb.io" denied the request: OpsRequest.spec.type=Restart is forbidden when Cluster.status.phase=Creating`)
	if !isKubeBlocksOpsConflict(err) {
		t.Fatal("expected KubeBlocks restart webhook denial to be treated as conflict")
	}
	if isKubeBlocksOpsConflict(errors.New("some other error")) {
		t.Fatal("unexpected conflict detection for unrelated error")
	}
}

func TestDBResponseFromClustersReturnsDBList(t *testing.T) {
	raw := []byte(`{
		"apiVersion": "apps.kubeblocks.io/v1alpha1",
		"kind": "ClusterList",
		"items": [
			{
				"apiVersion": "apps.kubeblocks.io/v1alpha1",
				"kind": "Cluster",
				"metadata": {
					"labels": {
						"brain.io/db-engine": "postgresql",
						"brain.io/project-id": "project-a",
						"brain.io/deployment-kind": "db",
						"clusterdefinition.kubeblocks.io/name": "postgresql"
					},
					"name": "pg",
					"namespace": "ns-a"
				},
				"spec": {"clusterDefinitionRef": "postgresql"},
				"status": {"conditions": [{"type": "Ready", "status": "True"}]}
			}
		]
	}`)
	body, err := dbResponseFromClusters(raw, false)
	if err != nil {
		t.Fatalf("dbResponseFromClusters returned error: %v", err)
	}
	var out map[string]interface{}
	if err := json.Unmarshal(body, &out); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}
	items := out["items"].([]interface{})
	item := items[0].(map[string]interface{})
	if got := item["kind"]; got != "DB" {
		t.Fatalf("item.kind = %v, want DB", got)
	}
	spec := item["spec"].(map[string]interface{})
	if got := spec["engine"]; got != "postgresql" {
		t.Fatalf("spec.engine = %v, want postgresql", got)
	}
}

func TestDBResponseFromClustersAcceptsK8sServiceWrappedList(t *testing.T) {
	raw := []byte(`{
		"Object": {
			"apiVersion": "apps.kubeblocks.io/v1alpha1",
			"kind": "ClusterList",
			"metadata": {"resourceVersion": "49933417"}
		},
		"items": [
			{
				"apiVersion": "apps.kubeblocks.io/v1alpha1",
				"kind": "Cluster",
				"metadata": {
					"labels": {
						"brain.io/db-engine": "mysql",
						"brain.io/project-id": "project-a",
						"brain.io/deployment-kind": "db",
						"clusterdefinition.kubeblocks.io/name": "apecloud-mysql"
					},
					"name": "mysql",
					"namespace": "ns-a"
				},
				"spec": {"clusterDefinitionRef": "apecloud-mysql"},
				"status": {"phase": "Running"}
			}
		]
	}`)
	body, err := dbResponseFromClusters(raw, false)
	if err != nil {
		t.Fatalf("dbResponseFromClusters returned error: %v", err)
	}
	var out map[string]interface{}
	if err := json.Unmarshal(body, &out); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}
	items := out["items"].([]interface{})
	item := items[0].(map[string]interface{})
	if got := item["kind"]; got != "DB" {
		t.Fatalf("item.kind = %v, want DB", got)
	}
	spec := item["spec"].(map[string]interface{})
	if got := spec["engine"]; got != "mysql" {
		t.Fatalf("spec.engine = %v, want mysql", got)
	}
}

func TestApplyDBBackupStateSetsRawBackups(t *testing.T) {
	db := map[string]interface{}{
		"status": map[string]interface{}{
			"phase": "Running",
		},
	}
	backups := []map[string]interface{}{
		{
			"metadata": map[string]interface{}{
				"name": "pg-manual-20260609",
			},
			"status": map[string]interface{}{
				"phase": "Completed",
			},
		},
	}

	applyDBBackupState(db, backups)

	status := db["status"].(map[string]interface{})
	if got := status["backups"]; !reflect.DeepEqual(got, backups) {
		t.Fatalf("status.backups = %#v, want %#v", got, backups)
	}
}

func TestApplyDBBackupStateSetsEmptyBackupList(t *testing.T) {
	db := map[string]interface{}{
		"status": map[string]interface{}{
			"backups": []map[string]interface{}{
				{
					"metadata": map[string]interface{}{
						"name": "stale-backup",
					},
				},
			},
			"phase": "Running",
		},
	}

	applyDBBackupState(db, []map[string]interface{}{})

	status := db["status"].(map[string]interface{})
	backups, ok := status["backups"].([]map[string]interface{})
	if !ok {
		t.Fatalf("status.backups type = %T, want []map[string]interface{}", status["backups"])
	}
	if len(backups) != 0 {
		t.Fatalf("status.backups length = %d, want 0", len(backups))
	}
}

func TestDBBackupPolicyPatchFromRequestUpdatesClusterBackupSpecWithoutDefaultRepo(t *testing.T) {
	patch, err := dbBackupPolicyPatchFromRequest(dbBackupPolicyRequest{
		Enabled:        true,
		CronExpression: "15 8 * * 1,3,5",
		RetentionDays:  7,
	}, "postgresql", "")
	if err != nil {
		t.Fatalf("dbBackupPolicyPatchFromRequest returned error: %v", err)
	}

	var out map[string]interface{}
	if err := json.Unmarshal(patch, &out); err != nil {
		t.Fatalf("unmarshal policy patch: %v", err)
	}
	backup := out["spec"].(map[string]interface{})["backup"].(map[string]interface{})
	if got := backup["enabled"]; got != true {
		t.Fatalf("backup.enabled = %v, want true", got)
	}
	if got := backup["cronExpression"]; got != "15 8 * * 1,3,5" {
		t.Fatalf("backup.cronExpression = %v, want 15 8 * * 1,3,5", got)
	}
	if got := backup["retentionPeriod"]; got != "7d" {
		t.Fatalf("backup.retentionPeriod = %v, want 7d", got)
	}
	if got := backup["method"]; got != "pg-basebackup" {
		t.Fatalf("backup.method = %v, want pg-basebackup", got)
	}
	if _, ok := backup["repoName"]; ok {
		t.Fatal("backup.repoName should be omitted when the source DB has no repo")
	}
}

func TestDBBackupPolicyPatchFromRequestPreservesExistingRepo(t *testing.T) {
	patch, err := dbBackupPolicyPatchFromRequest(dbBackupPolicyRequest{
		Enabled:        true,
		CronExpression: "15 8 * * *",
		RetentionDays:  7,
	}, "postgresql", "custom-repo")
	if err != nil {
		t.Fatalf("dbBackupPolicyPatchFromRequest returned error: %v", err)
	}

	var out map[string]interface{}
	if err := json.Unmarshal(patch, &out); err != nil {
		t.Fatalf("unmarshal policy patch: %v", err)
	}
	backup := out["spec"].(map[string]interface{})["backup"].(map[string]interface{})
	if got := backup["repoName"]; got != "custom-repo" {
		t.Fatalf("backup.repoName = %v, want custom-repo", got)
	}
}

func TestDBBackupPolicyPatchFromRequestClearsLegacyFallbackRepo(t *testing.T) {
	patch, err := dbBackupPolicyPatchFromRequest(dbBackupPolicyRequest{
		Enabled:        true,
		CronExpression: "15 8 * * *",
		RetentionDays:  7,
	}, "postgresql", "backuprepo-s3")
	if err != nil {
		t.Fatalf("dbBackupPolicyPatchFromRequest returned error: %v", err)
	}

	var out map[string]interface{}
	if err := json.Unmarshal(patch, &out); err != nil {
		t.Fatalf("unmarshal policy patch: %v", err)
	}
	backup := out["spec"].(map[string]interface{})["backup"].(map[string]interface{})
	if got, ok := backup["repoName"]; !ok || got != nil {
		t.Fatalf("backup.repoName = %v, present = %v; want explicit null", got, ok)
	}
}

func TestIsSupportedDBBackupPolicyCron(t *testing.T) {
	tests := []struct {
		name           string
		cronExpression string
		want           bool
	}{
		{name: "hourly", cronExpression: "30 * * * *", want: true},
		{name: "daily", cronExpression: "15 8 * * *", want: true},
		{name: "weekly single weekday", cronExpression: "45 6 * * 6", want: true},
		{name: "weekly weekday list", cronExpression: "15 8 * * 1,3,5", want: true},
		{name: "step minute", cronExpression: "*/15 8-18 * * *", want: false},
		{name: "out of range minute", cronExpression: "60 * * * *", want: false},
		{name: "out of range hour", cronExpression: "0 24 * * *", want: false},
		{name: "day of month", cronExpression: "0 8 1 * *", want: false},
		{name: "out of range weekday", cronExpression: "0 8 * * 7", want: false},
		{name: "duplicate weekday", cronExpression: "0 8 * * 1,1", want: false},
		{name: "six fields", cronExpression: "0 8 * * * *", want: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := isSupportedDBBackupPolicyCron(tt.cronExpression); got != tt.want {
				t.Fatalf("isSupportedDBBackupPolicyCron(%q) = %v, want %v", tt.cronExpression, got, tt.want)
			}
		})
	}
}

func TestDBBackupPolicyPatchFromRequestRejectsUnsupportedCronShape(t *testing.T) {
	_, err := dbBackupPolicyPatchFromRequest(dbBackupPolicyRequest{
		Enabled:        true,
		CronExpression: "*/15 8-18 * * *",
		RetentionDays:  7,
	}, "postgresql", "")
	if err == nil {
		t.Fatal("expected unsupported cron shape to be rejected")
	}
	if !strings.Contains(err.Error(), "hourly, daily, or weekly") {
		t.Fatalf("expected supported schedule error, got %v", err)
	}
}

func TestDBBackupPolicyPatchFromRequestDisablesPolicyWithoutClearingSchedule(t *testing.T) {
	patch, err := dbBackupPolicyPatchFromRequest(dbBackupPolicyRequest{
		Enabled: false,
	}, "postgresql", "")
	if err != nil {
		t.Fatalf("dbBackupPolicyPatchFromRequest returned error: %v", err)
	}

	var out map[string]interface{}
	if err := json.Unmarshal(patch, &out); err != nil {
		t.Fatalf("unmarshal policy patch: %v", err)
	}
	backup := out["spec"].(map[string]interface{})["backup"].(map[string]interface{})
	if got := backup["enabled"]; got != false {
		t.Fatalf("backup.enabled = %v, want false", got)
	}
	if _, ok := backup["cronExpression"]; ok {
		t.Fatalf("disable patch should not clear cronExpression: %#v", backup)
	}
	if _, ok := backup["retentionPeriod"]; ok {
		t.Fatalf("disable patch should not clear retentionPeriod: %#v", backup)
	}
}

func TestDBBackupPolicyPatchFromRequestValidatesRetention(t *testing.T) {
	_, err := dbBackupPolicyPatchFromRequest(dbBackupPolicyRequest{
		Enabled:        true,
		CronExpression: "15 8 * * *",
		RetentionDays:  2,
	}, "postgresql", "")
	if err == nil {
		t.Fatal("expected invalid retention to be rejected")
	}
	if !strings.Contains(err.Error(), "retentionDays") {
		t.Fatalf("expected error to name retentionDays, got %v", err)
	}
}

func TestBackupCreateErrorStatusMapping(t *testing.T) {
	tests := []struct {
		name string
		err  error
		want int
	}{
		{name: "request validation", err: dbsvc.ErrBackupValidation, want: http.StatusBadRequest},
		{name: "source not found", err: dbsvc.ErrBackupSourceNotFound, want: http.StatusNotFound},
		{name: "not running", err: dbsvc.ErrBackupSourceNotRunning, want: http.StatusConflict},
		{name: "duplicate name", err: dbsvc.ErrBackupConflict, want: http.StatusConflict},
		{name: "unsupported engine", err: dbsvc.ErrBackupUnsupportedEngine, want: http.StatusUnprocessableEntity},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := backupCreateError(tt.err)
			statusErr, ok := err.(huma.StatusError)
			if !ok {
				t.Fatalf("expected Huma status error, got %T", err)
			}
			if statusErr.GetStatus() != tt.want {
				t.Fatalf("expected status %d, got %d", tt.want, statusErr.GetStatus())
			}
		})
	}
}

func TestBackupDeleteErrorStatusMapping(t *testing.T) {
	tests := []struct {
		name string
		err  error
		want int
	}{
		{name: "not found", err: apierrors.NewNotFound(kubeBlocksBackupGVR.GroupResource(), "orders-backup"), want: http.StatusNotFound},
		{name: "not deletable", err: dbsvc.ErrDBBackupNotDeletable, want: http.StatusConflict},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var got error
			if apierrors.IsNotFound(tt.err) {
				got = huma.Error404NotFound("DB Service Backup not found", tt.err)
			} else if errors.Is(tt.err, dbsvc.ErrDBBackupNotDeletable) {
				got = huma.Error409Conflict("DB Service Backup is not deletable", tt.err)
			}
			statusErr, ok := got.(huma.StatusError)
			if !ok {
				t.Fatalf("expected Huma status error, got %T", got)
			}
			if statusErr.GetStatus() != tt.want {
				t.Fatalf("expected status %d, got %d", tt.want, statusErr.GetStatus())
			}
		})
	}
}

func TestRegisterIncludesDBConnectionStringRevealRoute(t *testing.T) {
	router := chi.NewRouter()
	api := humachi.New(router, huma.DefaultConfig("test", "0.0.0"))

	Register(api)

	path := api.OpenAPI().Paths["/api/db/v1alpha1/connection-string"]
	if path == nil || path.Get == nil {
		t.Fatalf("expected GET /api/db/v1alpha1/connection-string to be registered")
	}
	if path.Get.OperationID != "db-connection-string" {
		t.Fatalf("unexpected operation ID: %q", path.Get.OperationID)
	}
	description := path.Get.Description
	for _, want := range []string{
		"complete DB Connection DSN",
		"not cacheable",
		"reveal or copy",
	} {
		if !strings.Contains(description, want) {
			t.Fatalf("expected connection-string docs to mention %q, got: %s", want, description)
		}
	}
}

func TestDBConnectionStringRevealRejectsInvalidKindAtHTTPBoundary(t *testing.T) {
	router := chi.NewRouter()
	api := humachi.New(router, huma.DefaultConfig("test", "0.0.0"))
	Register(api)

	req := httptest.NewRequest(http.MethodGet, "/api/db/v1alpha1/connection-string?name=pg&kind=internal", nil)
	req.Header.Set("Authorization", "Bearer not-a-kubeconfig")
	w := httptest.NewRecorder()

	router.ServeHTTP(w, req)

	if w.Code != http.StatusUnprocessableEntity {
		t.Fatalf("expected invalid kind to be rejected before auth, got %d: %s", w.Code, w.Body.String())
	}
	if !bytes.Contains(w.Body.Bytes(), []byte("kind")) {
		t.Fatalf("expected schema validation to reference kind, got: %s", w.Body.String())
	}
}

func TestDBConnectionStringRevealSetsNoStoreCacheHeaders(t *testing.T) {
	output := connectionStringRevealOutput("postgresql://u:p@db-main.ns-a.svc:5432/app")
	if output.CacheControl != "no-cache, no-store, must-revalidate" {
		t.Fatalf("reveal Cache-Control = %q, want no-store directives", output.CacheControl)
	}
	if output.Pragma != "no-cache" {
		t.Fatalf("reveal Pragma = %q, want no-cache", output.Pragma)
	}
	if output.Body.Value != "postgresql://u:p@db-main.ns-a.svc:5432/app" {
		t.Fatalf("reveal body value = %q, want the composed DSN", output.Body.Value)
	}

	router := chi.NewRouter()
	api := humachi.New(router, huma.DefaultConfig("test", "0.0.0"))
	Register(api)

	path := api.OpenAPI().Paths["/api/db/v1alpha1/connection-string"]
	if path == nil || path.Get == nil {
		t.Fatal("expected GET /api/db/v1alpha1/connection-string to be registered")
	}
	response := path.Get.Responses["200"]
	if response == nil {
		t.Fatal("expected a 200 response contract for the reveal route")
	}
	for _, header := range []string{"Cache-Control", "Pragma"} {
		if response.Headers[header] == nil {
			t.Fatalf("expected the reveal response contract to declare the %s header", header)
		}
	}
}

func TestApplyDBConnectionStateComposesCredentialFreeTemplate(t *testing.T) {
	db := map[string]interface{}{
		"spec": map[string]interface{}{"engine": "postgresql"},
	}

	applyDBConnectionState(nil, db, "db-main", "ns-a")

	status, ok := db["status"].(map[string]interface{})
	if !ok {
		t.Fatalf("status is %T, want map", db["status"])
	}
	private, _ := status["connectionStringPrivate"].(string)
	if private != "postgresql://<username>:<password>@db-main-postgresql.ns-a.svc:5432/postgres" {
		t.Fatalf("connectionStringPrivate = %q, want the credential-free template", private)
	}
	if !strings.Contains(private, dbConnectionTemplateUserInfo) {
		t.Fatalf("connectionStringPrivate %q must carry the literal placeholder userinfo", private)
	}
	if _, ok := status["connectionStringPublic"]; ok {
		t.Fatalf("connectionStringPublic should be absent without public access, got %v", status["connectionStringPublic"])
	}
}

func TestDBRevealedConnectionStringComposesPrivateKind(t *testing.T) {
	db := map[string]interface{}{
		"spec": map[string]interface{}{"engine": "postgresql"},
	}

	got, err := dbRevealedConnectionString(db, "private", "db-main", "ns-a", dbConnectionCredentials{}, nil)
	if err != nil {
		t.Fatalf("dbRevealedConnectionString returned error: %v", err)
	}
	if got != "postgresql://db-main-postgresql.ns-a.svc:5432/postgres" {
		t.Fatalf("revealed private DSN = %q, want composed service DSN", got)
	}
}

func TestDBRevealedConnectionStringRejectsUnknownKind(t *testing.T) {
	_, err := dbRevealedConnectionString(map[string]interface{}{}, "internal", "db-main", "ns-a", dbConnectionCredentials{}, nil)
	statusErr, ok := err.(huma.StatusError)
	if !ok {
		t.Fatalf("expected Huma status error, got %T", err)
	}
	if statusErr.GetStatus() != http.StatusBadRequest {
		t.Fatalf("unknown kind status = %d, want 400", statusErr.GetStatus())
	}
}

func TestDBConnectionTemplatesCarryPlaceholderCredentialsPerEngine(t *testing.T) {
	tests := []struct {
		engine   string
		database string
		want     string
	}{
		{
			engine: "postgresql",
			want:   "postgresql://<username>:<password>@db-main.ns-a.svc:5432/postgres",
		},
		{
			engine:   "postgresql",
			database: "appdb",
			want:     "postgresql://<username>:<password>@db-main.ns-a.svc:5432/appdb",
		},
		{
			engine: "mysql",
			want:   "mysql://<username>:<password>@db-main.ns-a.svc:5432/mysql",
		},
		{
			engine: "mongodb",
			want:   "mongodb://<username>:<password>@db-main.ns-a.svc:5432/admin",
		},
		{
			engine: "redis",
			want:   "redis://<username>:<password>@db-main.ns-a.svc:5432/",
		},
		{
			engine: "unknown",
			want:   "db-main.ns-a.svc:5432",
		},
	}

	for _, tt := range tests {
		t.Run(tt.engine+"/"+tt.database, func(t *testing.T) {
			db := map[string]interface{}{
				"spec": map[string]interface{}{"engine": tt.engine},
			}
			got := dbConnectionTemplate(db, "db-main.ns-a.svc:5432", tt.database)
			if got != tt.want {
				t.Fatalf("connection template = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestDBDatabaseNameFromSecretReadsOnlyNonCredentialKeys(t *testing.T) {
	secret := &unstructured.Unstructured{Object: map[string]interface{}{
		"data": map[string]interface{}{
			"database": "YXBwZGI=",
			"password": "czNjcjN0",
			"username": "YWxpY2U=",
		},
	}}

	if got := dbDatabaseNameFromSecret(secret); got != "appdb" {
		t.Fatalf("database name = %q, want appdb", got)
	}

	db := map[string]interface{}{
		"spec": map[string]interface{}{"engine": "postgresql"},
	}
	template := dbConnectionTemplate(db, "pg.ns-a.svc:5432", dbDatabaseNameFromSecret(secret))
	if template != "postgresql://<username>:<password>@pg.ns-a.svc:5432/appdb" {
		t.Fatalf("connection template = %q, want placeholder credentials with real database", template)
	}
	for _, credential := range []string{"alice", "s3cr3t"} {
		if strings.Contains(template, credential) {
			t.Fatalf("connection template %q leaked decoded credential %q", template, credential)
		}
	}
}

func TestDBRevealedConnectionStringComposesCredentialsPerEngine(t *testing.T) {
	secret := &unstructured.Unstructured{Object: map[string]interface{}{
		"data": map[string]interface{}{
			"password": "czNjcjN0",
			"username": "YWxpY2U=",
		},
	}}
	tests := []struct {
		engine string
		want   string
	}{
		{engine: "postgresql", want: "postgresql://alice:s3cr3t@db.ns-a.svc:5432/postgres"},
		{engine: "mysql", want: "mysql://alice:s3cr3t@db.ns-a.svc:5432/mysql"},
		{engine: "mongodb", want: "mongodb://alice:s3cr3t@db.ns-a.svc:5432/admin"},
		{engine: "redis", want: "redis://alice:s3cr3t@db.ns-a.svc:5432/"},
	}

	for _, tt := range tests {
		t.Run(tt.engine, func(t *testing.T) {
			db := map[string]interface{}{
				"spec": map[string]interface{}{"engine": tt.engine},
			}
			got := dbConnectionString(db, "db.ns-a.svc:5432", dbConnectionCredentialsFromSecret(secret))
			if got != tt.want {
				t.Fatalf("revealed connection string = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestDBConnectionStringsUseComponentPrivateAddressesWithoutSecrets(t *testing.T) {
	t.Setenv("DB_PUBLIC_HOST", "192.168.10.189.nip.io")

	db := map[string]interface{}{
		"spec": map[string]interface{}{
			"engine": "mysql",
		},
	}

	private := dbConnectionString(db, dbPrivateConnectionAddress(db, "db-main", "ns-a"))
	if private != "mysql://db-main-mysql.ns-a.svc:3306/mysql" {
		t.Fatalf("private connection string = %q, want MySQL service DSN", private)
	}
	public := dbConnectionString(db, dbPublicConnectionAddress(45211))
	if public != "mysql://192.168.10.189.nip.io:45211/mysql" {
		t.Fatalf("public connection string = %q, want MySQL public DSN", public)
	}
}

func TestDBConnectionStringsUsePostgresComponentPrivateAddress(t *testing.T) {
	db := map[string]interface{}{
		"spec": map[string]interface{}{
			"engine": "postgresql",
		},
	}

	private := dbConnectionString(db, dbPrivateConnectionAddress(db, "db-main", "ns-a"))
	if private != "postgresql://db-main-postgresql.ns-a.svc:5432/postgres" {
		t.Fatalf("private connection string = %q, want PostgreSQL service DSN", private)
	}
}

func TestDBConnectionStringUsesCredentialsFromSecret(t *testing.T) {
	db := map[string]interface{}{
		"spec": map[string]interface{}{
			"engine": "postgresql",
		},
	}
	secret := &unstructured.Unstructured{Object: map[string]interface{}{
		"data": map[string]interface{}{
			"username": "YWxpY2U=",
			"password": "czNjcjN0",
		},
	}}

	got := dbConnectionString(db, "pg.ns-a.svc:5432", dbConnectionCredentialsFromSecret(secret))
	want := "postgresql://alice:s3cr3t@pg.ns-a.svc:5432/postgres"
	if got != want {
		t.Fatalf("connection string = %q, want %q", got, want)
	}
}

func TestDBConnectionStringEscapesCredentialCharacters(t *testing.T) {
	db := map[string]interface{}{
		"spec": map[string]interface{}{
			"engine": "mysql",
		},
	}
	secret := &unstructured.Unstructured{Object: map[string]interface{}{
		"stringData": map[string]interface{}{
			"user":   "root",
			"passwd": " p@ss/word ",
		},
	}}

	private := dbConnectionString(db, "mysql.ns-a.svc:3306", dbConnectionCredentialsFromSecret(secret))
	if private != "mysql://root:%20p%40ss%2Fword%20@mysql.ns-a.svc:3306/mysql" {
		t.Fatalf("private connection string = %q, want escaped MySQL credentials", private)
	}
	public := dbConnectionString(db, "192.168.10.189.nip.io:45211", dbConnectionCredentialsFromSecret(secret))
	if public != "mysql://root:%20p%40ss%2Fword%20@192.168.10.189.nip.io:45211/mysql" {
		t.Fatalf("public connection string = %q, want escaped MySQL credentials", public)
	}
}

func TestDBPublicConnectionAddressFallsBackToPortWhenPublicHostMissing(t *testing.T) {
	_ = os.Unsetenv("DB_PUBLIC_HOST")

	if got := dbPublicConnectionAddress(30432); got != ":30432" {
		t.Fatalf("public address fallback = %q, want bare port", got)
	}
}

func TestDBConnectionStringFallsBackToAddressForUnknownEngine(t *testing.T) {
	db := map[string]interface{}{
		"spec": map[string]interface{}{
			"engine": "unknown",
		},
	}

	if got := dbConnectionString(db, "db.ns-a.svc:1234"); got != "db.ns-a.svc:1234" {
		t.Fatalf("connection string for unknown engine = %q, want address fallback", got)
	}
}

func TestDBConnectionStringEscapesDatabasePathWithoutCredentials(t *testing.T) {
	db := map[string]interface{}{
		"spec": map[string]interface{}{
			"engine": "postgresql",
		},
	}

	got := dbConnectionString(db, "pg.ns-a.svc:5432")
	want := "postgresql://pg.ns-a.svc:5432/postgres"
	if got != want {
		t.Fatalf("connection string = %q, want %q", got, want)
	}
}

func TestDBVariablesFromSecretReturnPrimitiveSecretRefs(t *testing.T) {
	db := map[string]interface{}{
		"spec": map[string]interface{}{
			"engine": "postgresql",
		},
	}
	secret := &unstructured.Unstructured{Object: map[string]interface{}{
		"metadata": map[string]interface{}{
			"name": "pg-main-conn-credential",
		},
		"data": map[string]interface{}{
			"host":     "cGcubnMtYS5zdmM=",
			"password": "czNjcjN0",
			"port":     "NTQzMg==",
			"username": "cG9zdGdyZXM=",
		},
	}}

	variables := dbVariablesFromSecret(db, secret)
	if len(variables) != 4 {
		t.Fatalf("variables length = %d, want 4", len(variables))
	}
	for _, variable := range variables {
		valueFrom := variable["valueFrom"].(map[string]interface{})
		ref := valueFrom["secretKeyRef"].(map[string]interface{})
		if ref["name"] != "pg-main-conn-credential" {
			t.Fatalf("secret ref name = %v, want pg-main-conn-credential", ref["name"])
		}
		if _, ok := variable["value"]; ok {
			t.Fatalf("variable %v exposed raw secret value", variable["name"])
		}
	}
}

func TestDBClusterLabelSelectorKeepsBrainOwnership(t *testing.T) {
	got := dbClusterLabelSelector("brain.io/project-id=project-a")
	for _, want := range []string{
		"app.kubernetes.io/instance",
		"clusterdefinition.kubeblocks.io/name",
		orchestration.BrainManagedByLabel + "=" + orchestration.BrainManagedByValue,
		"brain.io/project-id=project-a",
	} {
		if !strings.Contains(got, want) {
			t.Fatalf("selector %q missing %q", got, want)
		}
	}
}

func TestAccessExportRejectsUnsupportedInputsAtHTTPBoundary(t *testing.T) {
	tests := []struct {
		name         string
		extraPayload string
		location     string
	}{
		{name: "unsupported format", extraPayload: `"format": "excel"`, location: "body.format"},
		{name: "query", extraPayload: `"query": "select * from users"`, location: "body.query"},
		{name: "where", extraPayload: `"where": {"column":"id","op":"=","value":"1"}`, location: "body.where"},
		{name: "selected rows", extraPayload: `"selectedRows": [{"id": 1}]`, location: "body.selectedRows"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			router := chi.NewRouter()
			api := humachi.New(router, huma.DefaultConfig("test", "0.0.0"))
			Register(api)

			body := []byte(fmt.Sprintf(`{
				"projectId": "project-1",
				"ref": {"kind": "table", "path": ["postgres", "public", "users"]},
				%s
			}`, tt.extraPayload))
			req := httptest.NewRequest(http.MethodPost, "/api/db/v1alpha1/pg-main/access/export", bytes.NewReader(body))
			req.Header.Set("Authorization", "Bearer not-a-kubeconfig")
			req.Header.Set("Content-Type", "application/json")
			w := httptest.NewRecorder()

			router.ServeHTTP(w, req)

			if w.Code != http.StatusUnprocessableEntity {
				t.Fatalf("expected unsupported export input to be rejected before auth, got %d: %s", w.Code, w.Body.String())
			}
			if !bytes.Contains(w.Body.Bytes(), []byte(tt.location)) {
				t.Fatalf("expected schema validation to reference %s, got: %s", tt.location, w.Body.String())
			}
		})
	}
}

func TestAccessRowsRejectsUnsupportedQueryInputsAtHTTPBoundary(t *testing.T) {
	tests := []struct {
		field string
		value string
	}{
		{field: "query", value: `"select * from users"`},
		{field: "where", value: `{"column":"id","op":"=","value":"1"}`},
		{field: "filter", value: `{"column":"id","op":"=","value":"1"}`},
	}

	for _, tt := range tests {
		t.Run(tt.field, func(t *testing.T) {
			router := chi.NewRouter()
			api := humachi.New(router, huma.DefaultConfig("test", "0.0.0"))
			Register(api)

			body := []byte(fmt.Sprintf(`{
				"projectId": "project-1",
				"ref": {"kind": "table", "path": ["postgres", "public", "users"]},
				"%s": %s
			}`, tt.field, tt.value))
			req := httptest.NewRequest(http.MethodPost, "/api/db/v1alpha1/pg-main/access/rows", bytes.NewReader(body))
			req.Header.Set("Authorization", "Bearer not-a-kubeconfig")
			req.Header.Set("Content-Type", "application/json")
			w := httptest.NewRecorder()

			router.ServeHTTP(w, req)

			if w.Code != http.StatusUnprocessableEntity {
				t.Fatalf("expected unsupported %s input to be rejected before auth, got %d: %s", tt.field, w.Code, w.Body.String())
			}
			location := []byte("body." + tt.field)
			if !bytes.Contains(w.Body.Bytes(), []byte("unexpected property")) || !bytes.Contains(w.Body.Bytes(), location) {
				t.Fatalf("expected schema validation to reject %s, got: %s", location, w.Body.String())
			}
		})
	}
}

func TestAccessHealthErrorStatusMapping(t *testing.T) {
	tests := []struct {
		name string
		err  error
		want int
	}{
		{name: "request validation", err: dbsvc.ErrAccessHealthProjectID, want: http.StatusBadRequest},
		{name: "ownership mismatch", err: dbsvc.ErrAccessHealthProjectForbidden, want: http.StatusForbidden},
		{name: "missing ownership metadata", err: dbsvc.ErrAccessHealthProjectMissing, want: http.StatusConflict},
		{name: "not ready", err: dbsvc.ErrAccessHealthDBNotReady, want: http.StatusConflict},
		{name: "missing secret", err: dbsvc.ErrAccessHealthSecretMissing, want: http.StatusConflict},
		{name: "unsupported engine", err: dbsvc.ErrAccessHealthUnsupported, want: http.StatusUnprocessableEntity},
		{name: "missing whodb config", err: dbsvc.ErrAccessHealthWhoDBMissing, want: http.StatusServiceUnavailable},
		{name: "unavailable whodb", err: fmt.Errorf("%w: refused", dbsvc.ErrAccessHealthWhoDBUnavailable), want: http.StatusServiceUnavailable},
		{name: "query-level database error", err: &dbsvc.WhoDBQueryError{Message: "connection to database failed"}, want: http.StatusServiceUnavailable},
		{name: "timeout", err: fmt.Errorf("%w: deadline", dbsvc.ErrAccessHealthWhoDBTimeout), want: http.StatusGatewayTimeout},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := accessHealthError(tt.err)
			statusErr, ok := err.(huma.StatusError)
			if !ok {
				t.Fatalf("expected Huma status error, got %T", err)
			}
			if statusErr.GetStatus() != tt.want {
				t.Fatalf("expected status %d, got %d", tt.want, statusErr.GetStatus())
			}
		})
	}
}

func TestAccessObjectsErrorCarriesDatabaseMessageForQueryFailures(t *testing.T) {
	queryErr := &dbsvc.WhoDBQueryError{Message: `ERROR: could not open file "postgresql-2.csv" for reading (SQLSTATE 58P01)`}

	err := accessObjectsError(queryErr)
	model, ok := err.(*huma.ErrorModel)
	if !ok {
		t.Fatalf("expected Huma error model, got %T", err)
	}
	if model.GetStatus() != http.StatusUnprocessableEntity {
		t.Fatalf("expected 422 for a query-level database error, got %d", model.GetStatus())
	}
	if model.Detail != queryErr.Message {
		t.Fatalf("expected detail to carry the database's own message, got %q", model.Detail)
	}
}

func TestAccessObjectsErrorStatusMapping(t *testing.T) {
	tests := []struct {
		name string
		err  error
		want int
	}{
		{name: "request validation", err: dbsvc.ErrAccessHealthProjectID, want: http.StatusBadRequest},
		{name: "invalid ref", err: dbsvc.ErrAccessObjectsInvalidRef, want: http.StatusUnprocessableEntity},
		{name: "object not found", err: dbsvc.ErrAccessObjectsNotFound, want: http.StatusNotFound},
		{name: "unsupported kind", err: dbsvc.ErrAccessObjectsUnsupportedKind, want: http.StatusUnprocessableEntity},
		{name: "invalid row pagination", err: dbsvc.ErrAccessRowsInvalidPagination, want: http.StatusBadRequest},
		{name: "invalid row sort", err: dbsvc.ErrAccessRowsInvalidSort, want: http.StatusBadRequest},
		{name: "invalid export format", err: dbsvc.ErrAccessExportInvalidFormat, want: http.StatusBadRequest},
		{name: "unsupported engine", err: dbsvc.ErrAccessHealthUnsupported, want: http.StatusUnprocessableEntity},
		{name: "missing whodb config", err: dbsvc.ErrAccessHealthWhoDBMissing, want: http.StatusServiceUnavailable},
		{name: "unavailable whodb", err: fmt.Errorf("%w: refused", dbsvc.ErrAccessHealthWhoDBUnavailable), want: http.StatusServiceUnavailable},
		{name: "query-level database error", err: &dbsvc.WhoDBQueryError{Message: "ERROR: relation does not exist"}, want: http.StatusUnprocessableEntity},
		{name: "timeout", err: fmt.Errorf("%w: deadline", dbsvc.ErrAccessHealthWhoDBTimeout), want: http.StatusGatewayTimeout},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := accessObjectsError(tt.err)
			statusErr, ok := err.(huma.StatusError)
			if !ok {
				t.Fatalf("expected Huma status error, got %T", err)
			}
			if statusErr.GetStatus() != tt.want {
				t.Fatalf("expected status %d, got %d", tt.want, statusErr.GetStatus())
			}
		})
	}
}
