package db

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	clientcmdapi "k8s.io/client-go/tools/clientcmd/api"
	"sigs.k8s.io/yaml"

	"sealos/api/middleware"
	dbsvc "sealos/api/service/db"
	k8ssvc "sealos/api/service/k8s"
	orchestration "sealos/api/service/orchestration"
)

func registerCreate(grp huma.API) {
	type dbCreateBody struct {
		YAML string `json:"yaml" required:"true" doc:"DB product manifest (YAML or JSON). The Go API renders it directly into a KubeBlocks Cluster and support resources. Required fields: metadata.name, spec.projectId, and spec.engine. Optional fields include spec.clusterVersion, spec.replicas, and spec.storageSize."`
	}
	type dbCreateInput struct {
		middleware.AuthInput
		Body dbCreateBody
	}
	type dbCreateOutput struct {
		Body struct {
			YAML string `json:"yaml" doc:"The created DB resource in YAML format (server state after apply)."`
		}
	}

	exampleYAML := `apiVersion: brain.io/direct
kind: DB
metadata:
  name: db-postgresql
  namespace: default
spec:
  projectId: project-id
  engine: postgresql
  clusterVersion: postgresql
  replicas: 1
  storageSize: 10Gi`

	huma.Register(grp, huma.Operation{
		OperationID: "db-create",
		Method:      http.MethodPut,
		Path:        "/",
		Summary:     "Create or replace DB",
		Description: "Create a DB instance from one Brain DB product manifest (PUT). The Go API renders a KubeBlocks Cluster and support resources, then returns the DB product view as YAML.\n\n" +
			"**Request body usage:**\n" +
			"- Send exactly one DB manifest in the `yaml` field.\n" +
			"- Required fields are `metadata.name`, `spec.projectId`, and `spec.engine`.\n\n" +
			"**Response:** Returns the created DB product view in YAML format.\n\n" +
			"**Copy-pasteable example (use in `yaml` field):**\n```yaml\n" + exampleYAML + "\n```",
		Tags: []string{"DB"},
	}, func(ctx context.Context, input *dbCreateInput) (*dbCreateOutput, error) {
		restConfig, cfg, err := middleware.RestConfigFromAuth(input.Authorization)
		if err != nil {
			return nil, huma.Error400BadRequest("invalid kubeconfig", err)
		}
		if input.Body.YAML == "" {
			return nil, huma.Error400BadRequest("body.yaml is required", nil)
		}

		var obj unstructured.Unstructured
		if err := yaml.Unmarshal([]byte(input.Body.YAML), &obj.Object); err != nil {
			return nil, huma.Error400BadRequest("invalid YAML", err)
		}
		name := obj.GetName()
		if name == "" {
			return nil, huma.Error400BadRequest("metadata.name is required", nil)
		}
		ns := obj.GetNamespace()
		if ns == "" {
			gvr := middleware.PodsGVR()
			resolved, err := middleware.ResolveContext(cfg, middleware.ResolveOptions{
				Namespace:        "",
				AllNamespaces:    false,
				DefaultNamespace: "default",
				AdminCheckGVR:    &gvr,
			})
			if err != nil {
				return nil, huma.Error500InternalServerError("failed to resolve namespace", err)
			}
			ns = resolved.Namespace
			if ns == "" {
				ns = "default"
			}
			obj.SetNamespace(ns)
			yamlBytes, _ := yaml.Marshal(obj.Object)
			input.Body.YAML = string(yamlBytes)
		}

		renderInput := dbRenderInputFromObject(obj, ns)
		resources, err := orchestration.RenderDBResources(renderInput)
		if err != nil {
			return nil, huma.Error400BadRequest("invalid DB direct resource request", err)
		}
		if err := k8ssvc.ApplyObjects(restConfig, []runtime.Object{resources.ExportService}, ns); err != nil {
			return nil, huma.Error500InternalServerError("failed to create DB support resources", err)
		}
		if err := k8ssvc.ApplyUnstructured(restConfig, []*unstructured.Unstructured{resources.Cluster}, ns); err != nil {
			return nil, huma.Error500InternalServerError("failed to create DB", err)
		}

		jsonBytes, err := k8ssvc.Get(cfg, k8ssvc.GetOptions{
			LabelSelector: dbClusterLabelSelector(""),
			Resource:      "clusters",
			Name:          name,
			Namespace:     ns,
		})
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to get created DB", err)
		}

		body, err := dbResponseFromClusters(jsonBytes, true)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to adapt created DB", err)
		}
		var created map[string]interface{}
		if err := json.Unmarshal(body, &created); err != nil {
			return nil, huma.Error500InternalServerError("failed to marshal created DB", err)
		}
		yamlBytes, err := yaml.Marshal(created)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to marshal created DB to YAML", err)
		}
		out := dbCreateOutput{}
		out.Body.YAML = string(yamlBytes)
		return &out, nil
	})
}

func dbRenderInputFromObject(obj unstructured.Unstructured, namespace string) orchestration.DBResourcesInput {
	spec, _ := obj.Object["spec"].(map[string]interface{})
	projectID := stringFromMap(spec, "projectId")
	if projectID == "" {
		projectID = stringFromMap(spec, "projectID")
	}
	engine := stringFromMap(spec, "engine")
	version := stringFromMap(spec, "clusterVersion")
	if version == "" {
		version = stringFromMap(spec, "version")
	}
	return orchestration.DBResourcesInput{
		ClusterVersion: version,
		Engine:         engine,
		Name:           obj.GetName(),
		Namespace:      namespace,
		ProjectID:      projectID,
		Replicas:       int64FromMap(spec, "replicas"),
		StorageSize:    stringFromMap(spec, "storageSize"),
	}
}

func stringFromMap(values map[string]interface{}, key string) string {
	if values == nil {
		return ""
	}
	value, _ := values[key].(string)
	return strings.TrimSpace(value)
}

func int64FromMap(values map[string]interface{}, key string) int64 {
	if values == nil {
		return 0
	}
	switch value := values[key].(type) {
	case int:
		return int64(value)
	case int32:
		return int64(value)
	case int64:
		return value
	case float64:
		return int64(value)
	default:
		return 0
	}
}

func registerBackup(grp huma.API) {
	type dbBackupBody struct {
		Name       string `json:"name" required:"true" doc:"DB instance name to create backup for"`
		BackupName string `json:"backupName,omitempty" doc:"Name for the Backup CR (defaults to {name}-manual-{timestamp})"`
		Namespace  string `json:"namespace,omitempty" doc:"Namespace (default from kubeconfig; admin can override)"`
	}
	type dbBackupInput struct {
		middleware.AuthInput
		Body dbBackupBody
	}
	type dbBackupOutput struct {
		Body json.RawMessage
	}

	huma.Register(grp, huma.Operation{
		OperationID: "db-backup",
		Method:      http.MethodPost,
		Path:        "/backup",
		Summary:     "Create backup for DB",
		Description: "Create an on-demand KubeBlocks backup for a specific DB.\n\n" +
			"The DB must have a running KubeBlocks Cluster with backup enabled (BackupPolicy exists). " +
			"For PostgreSQL, uses pg-basebackup method. Returns the created Backup resource.",
		Tags: []string{"DB"},
	}, func(ctx context.Context, input *dbBackupInput) (*dbBackupOutput, error) {
		_, cfg, err := middleware.RestConfigFromAuth(input.Authorization)
		if err != nil {
			return nil, huma.Error400BadRequest("invalid kubeconfig", err)
		}
		if input.Body.Name == "" {
			return nil, huma.Error400BadRequest("name is required", nil)
		}
		gvr := middleware.PodsGVR()
		resolved, err := middleware.ResolveContext(cfg, middleware.ResolveOptions{
			Namespace:        input.Body.Namespace,
			AllNamespaces:    false,
			DefaultNamespace: "",
			AdminCheckGVR:    &gvr,
		})
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to resolve namespace", err)
		}
		ns := resolved.Namespace

		jsonBytes, err := dbsvc.CreateBackupForDB(cfg, dbsvc.CreateBackupForDBOptions{
			DBName:     input.Body.Name,
			Namespace:  ns,
			BackupName: input.Body.BackupName,
		})
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to create backup", err)
		}
		return &dbBackupOutput{Body: json.RawMessage(jsonBytes)}, nil
	})
}

type dbLifecycleBody struct {
	Name      string `json:"name" required:"true" doc:"DB claim metadata.name."`
	Namespace string `json:"namespace" doc:"Namespace of the DB (default from kubeconfig; admin can override)."`
}

type dbLifecycleInput struct {
	middleware.AuthInput
	Body dbLifecycleBody
}

type dbLifecycleOutput struct {
	Body json.RawMessage
}

func registerStart(grp huma.API) {
	huma.Register(grp, huma.Operation{
		OperationID: "db-start",
		Method:      http.MethodPost,
		Path:        "/start",
		Summary:     "Start DB workload",
		Description: "Starts a DB by clearing the Brain pause annotation on the KubeBlocks Cluster.",
		Tags:        []string{"DB"},
	}, func(ctx context.Context, input *dbLifecycleInput) (*dbLifecycleOutput, error) {
		return patchLifecycleDB(input, dbClusterPausedPatch(false), "start")
	})
}

func registerStop(grp huma.API) {
	huma.Register(grp, huma.Operation{
		OperationID: "db-stop",
		Method:      http.MethodPost,
		Path:        "/stop",
		Summary:     "Stop DB workload",
		Description: "Stops a DB by setting the Brain pause annotation on the KubeBlocks Cluster. Data and configuration are preserved.",
		Tags:        []string{"DB"},
	}, func(ctx context.Context, input *dbLifecycleInput) (*dbLifecycleOutput, error) {
		return patchLifecycleDB(input, dbClusterPausedPatch(true), "stop")
	})
}

func registerRestart(grp huma.API) {
	huma.Register(grp, huma.Operation{
		OperationID: "db-restart",
		Method:      http.MethodPost,
		Path:        "/restart",
		Summary:     "Restart DB workload",
		Description: "Requests a DB restart by creating a KubeBlocks Restart OpsRequest for the Cluster.",
		Tags:        []string{"DB"},
	}, func(ctx context.Context, input *dbLifecycleInput) (*dbLifecycleOutput, error) {
		_, name, namespace, err := lifecycleDBContext(input)
		if err != nil {
			return nil, err
		}

		ops, err := orchestration.RenderDBRestartOpsRequest(name, namespace, time.Now())
		if err != nil {
			return nil, huma.Error422UnprocessableEntity("invalid DB restart request", err)
		}
		restConfig, _, err := middleware.RestConfigFromAuth(input.Authorization)
		if err != nil {
			return nil, huma.Error400BadRequest("invalid kubeconfig", err)
		}
		if err := k8ssvc.ApplyUnstructured(restConfig, []*unstructured.Unstructured{ops}, namespace); err != nil {
			return nil, huma.Error500InternalServerError("failed to restart DB", err)
		}
		body, _ := json.Marshal(ops.Object)
		return &dbLifecycleOutput{Body: body}, nil
	})
}

func patchLifecycleDB(input *dbLifecycleInput, patch []byte, action string) (*dbLifecycleOutput, error) {
	cfg, name, namespace, err := lifecycleDBContext(input)
	if err != nil {
		return nil, err
	}

	jsonBytes, err := k8ssvc.Patch(cfg, k8ssvc.PatchOptions{
		Resource:  "clusters",
		Name:      name,
		Namespace: namespace,
		PatchType: k8ssvc.PatchTypeMerge,
		Patch:     patch,
	})
	if err != nil {
		if apierrors.IsNotFound(err) {
			return nil, huma.Error404NotFound("DB not found", err)
		}
		return nil, huma.Error500InternalServerError("failed to "+action+" DB", err)
	}
	body, err := dbResponseFromClusters(jsonBytes, true)
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to adapt DB response", err)
	}
	return &dbLifecycleOutput{Body: body}, nil
}

func dbClusterPausedPatch(paused bool) []byte {
	value := "false"
	if paused {
		value = "true"
	}
	bytes, _ := json.Marshal(map[string]interface{}{
		"metadata": map[string]interface{}{
			"annotations": map[string]interface{}{
				"brain.io/paused": value,
			},
		},
	})
	return bytes
}

func lifecycleDBContext(input *dbLifecycleInput) (*clientcmdapi.Config, string, string, error) {
	_, cfg, err := middleware.RestConfigFromAuth(input.Authorization)
	if err != nil {
		return nil, "", "", huma.Error400BadRequest("invalid kubeconfig", err)
	}
	name := strings.TrimSpace(input.Body.Name)
	if name == "" {
		return nil, "", "", huma.Error400BadRequest("name is required", nil)
	}

	gvr := middleware.PodsGVR()
	resolved, err := middleware.ResolveContext(cfg, middleware.ResolveOptions{
		Namespace:        input.Body.Namespace,
		AllNamespaces:    false,
		DefaultNamespace: "",
		AdminCheckGVR:    &gvr,
	})
	if err != nil {
		return nil, "", "", huma.Error500InternalServerError("failed to resolve request context", err)
	}
	return cfg, name, resolved.Namespace, nil
}

func registerUpdate(grp huma.API) {
	type dbUpdateInput struct {
		middleware.AuthInput
		Name      string          `query:"name" required:"true" doc:"DB instance name to patch"`
		Namespace string          `query:"namespace" doc:"Namespace (default from kubeconfig; admin can override)"`
		Body      json.RawMessage `contentType:"application/json" required:"true" doc:"JSON merge patch body applied to the DB resource.\n\nWhat to patch:\n- spec.quota: switch preset xs|s|m|l (recomputes quota preset defaults unless overridden fields remain).\n- spec.replicas: desired database replica count when running; preserved while spec.paused is true.\n- spec.paused: lifecycle flag; true stops DB compute, false resumes using spec.replicas.\n- spec.restartRequest: non-negative lifecycle counter; prefer POST /restart so the server increments it.\n- spec.storageSize: change PVC storage (may require expansion support).\n- spec.cpuRequest / spec.memoryRequest: resource requests.\n- spec.cpuLimit / spec.memoryLimit: resource limits.\n- spec.storageClassName: StorageClass for PVCs.\n- spec.terminationPolicy: Delete or WipeOut.\n- spec.exposeNodePort: enable or disable NodePort Service {name}-export (boolean).\n- spec.scheduledBackup: cron, enabled, retentionPeriod, repoName (MongoDB) for KubeBlocks automated backups.\n\nPatch examples:\n- Stop: {\"spec\":{\"paused\":true}}\n- Start: {\"spec\":{\"paused\":false}}\n- Scale replicas: {\"spec\":{\"replicas\":2}}\n- Larger quota: {\"spec\":{\"quota\":\"m\"}}\n- Expose via NodePort: {\"spec\":{\"exposeNodePort\":true}}\n- Update resources: {\"spec\":{\"cpuLimit\":\"2000m\",\"memoryLimit\":\"4Gi\"}}\n- Change storage: {\"spec\":{\"storageSize\":\"20Gi\"}}\n- Backup schedule: {\"spec\":{\"scheduledBackup\":{\"cronExpression\":\"0 2 * * *\",\"retentionPeriod\":\"7d\"}}}\n\nPatch semantics:\n- Only the fields you send are changed.\n- For nested objects like spec, send the subtree you want to modify."`
	}
	type dbUpdateOutput struct {
		Body json.RawMessage
	}

	huma.Register(grp, huma.Operation{
		OperationID: "db-update",
		Method:      http.MethodPatch,
		Path:        "/",
		Summary:     "Update DB",
		Description: "Patch a DB instance by name.\n\nRequest parameter usage:\n- `name` is required and selects the DB to patch.\n- `namespace` is optional; admins can use it to target a different namespace.\n- The request body must be a JSON merge patch fragment for the DB resource.\n\nPatch semantics:\n- Only the fields present in the patch body are changed.\n- Nested objects are merged at the subtree you provide.\n\nCommon patch targets:\n- `spec.quota`: resource preset xs|s|m|l.\n- `spec.replicas`: desired database replica count when running; preserved while `spec.paused` is true.\n- `spec.paused`: lifecycle flag; true stops DB compute, false resumes using `spec.replicas`.\n- `spec.restartRequest`: non-negative restart counter; prefer `POST /api/db/v1alpha1/restart` so the server increments it.\n- `spec.storageSize`: change PVC storage.\n- `spec.cpuRequest` / `spec.memoryRequest`: resource requests.\n- `spec.cpuLimit` / `spec.memoryLimit`: resource limits.\n- `spec.storageClassName`: StorageClass for PVCs.\n- `spec.terminationPolicy`: Delete or WipeOut.\n- `spec.exposeNodePort`: toggle NodePort Service `{metadata.name}-export`.\n- `spec.scheduledBackup`: automated backup cron/retention/repo (KubeBlocks).",
		Tags:        []string{"DB"},
	}, func(ctx context.Context, input *dbUpdateInput) (*dbUpdateOutput, error) {
		_, cfg, err := middleware.RestConfigFromAuth(input.Authorization)
		if err != nil {
			return nil, huma.Error400BadRequest("invalid kubeconfig", err)
		}
		if input.Name == "" {
			return nil, huma.Error400BadRequest("name is required", nil)
		}
		if len(input.Body) == 0 {
			return nil, huma.Error400BadRequest("patch body is required", nil)
		}

		gvr := middleware.PodsGVR()
		resolved, err := middleware.ResolveContext(cfg, middleware.ResolveOptions{
			Namespace:        input.Namespace,
			AllNamespaces:    false,
			DefaultNamespace: "",
			AdminCheckGVR:    &gvr,
		})
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to resolve request context", err)
		}

		jsonBytes, err := k8ssvc.Patch(cfg, k8ssvc.PatchOptions{
			Resource:  "clusters",
			Name:      input.Name,
			Namespace: resolved.Namespace,
			PatchType: k8ssvc.PatchTypeMerge,
			Patch:     input.Body,
		})
		if err != nil {
			if apierrors.IsNotFound(err) {
				return nil, huma.Error404NotFound("DB not found", err)
			}
			return nil, huma.Error500InternalServerError("failed to update DB", err)
		}
		body, err := dbResponseFromClusters(jsonBytes, true)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to adapt DB response", err)
		}
		return &dbUpdateOutput{Body: body}, nil
	})
}

func registerDelete(grp huma.API) {
	type dbDeleteInput struct {
		middleware.AuthInput
		Name      string `query:"name" required:"true" doc:"DB instance name to delete"`
		Namespace string `query:"namespace" doc:"Namespace (default from kubeconfig; admin can override)"`
	}
	type dbDeleteOutput struct {
		Body struct {
			Status string `json:"status"`
		}
	}

	huma.Register(grp, huma.Operation{
		OperationID: "db-delete",
		Method:      http.MethodDelete,
		Path:        "/",
		Summary:     "Delete DB",
		Description: "Delete a DB instance by name.\n\nParameter usage:\n- `name` is required and selects the DB to delete.\n- `namespace` is optional; admins can override the namespace from kubeconfig.\n\nBehavior:\n- The Go API explicitly deletes Brain-managed DB support resources and the KubeBlocks Cluster using brain.io labels.",
		Tags:        []string{"DB"},
	}, func(ctx context.Context, input *dbDeleteInput) (*dbDeleteOutput, error) {
		_, cfg, err := middleware.RestConfigFromAuth(input.Authorization)
		if err != nil {
			return nil, huma.Error400BadRequest("invalid kubeconfig", err)
		}
		if input.Name == "" {
			return nil, huma.Error400BadRequest("name is required", nil)
		}

		gvr := middleware.PodsGVR()
		resolved, err := middleware.ResolveContext(cfg, middleware.ResolveOptions{
			Namespace:        input.Namespace,
			AllNamespaces:    false,
			DefaultNamespace: "",
			AdminCheckGVR:    &gvr,
		})
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to resolve request context", err)
		}

		if err := deleteDBDirectResources(cfg, input.Name, resolved.Namespace); err != nil {
			if apierrors.IsNotFound(err) {
				return nil, huma.Error404NotFound("DB not found", err)
			}
			return nil, huma.Error500InternalServerError("failed to delete DB", err)
		}
		return &dbDeleteOutput{
			Body: struct {
				Status string `json:"status"`
			}{
				Status: "deleted",
			},
		}, nil
	})
}

func deleteDBDirectResources(cfg *clientcmdapi.Config, name string, namespace string) error {
	selector := orchestration.BrainManagedByLabel + "=" + orchestration.BrainManagedByValue + "," + orchestration.BrainDBNameLabel + "=" + name
	for _, resource := range []string{"services", "opsrequests", "configmaps", "secrets"} {
		_, err := k8ssvc.Delete(cfg, k8ssvc.DeleteOptions{
			LabelSelector: selector,
			Namespace:     namespace,
			Resource:      resource,
		})
		if err != nil && !apierrors.IsNotFound(err) && !k8ssvc.IsUnknownResourceError(err, resource) {
			return err
		}
	}
	_, err := k8ssvc.Delete(cfg, k8ssvc.DeleteOptions{
		Name:      name,
		Namespace: namespace,
		Resource:  "clusters",
	})
	if err != nil && apierrors.IsNotFound(err) {
		return nil
	}
	return err
}
