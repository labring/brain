package db

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/api/resource"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/rest"
	clientcmdapi "k8s.io/client-go/tools/clientcmd/api"
	"sigs.k8s.io/yaml"

	"sealos/api/middleware"
	dbsvc "sealos/api/service/db"
	k8ssvc "sealos/api/service/k8s"
	orchestration "sealos/api/service/orchestration"
)

var dbRestoreValidationErrorFragments = []string{
	"completed DB Service Backup",
	"does not belong",
	"different from the source",
	"same namespace",
	"unsupported DB engine",
	"projectId",
	"DB Service name",
}

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
  clusterVersion: postgresql-16.4.0
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
			resolved, err := middleware.ResolveContext(cfg, middleware.ResolveOptions{
				Namespace: "", DefaultNamespace: "default"})
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
		if err := ensureDBCreateTargetIsBrainManaged(cfg, name, ns); err != nil {
			return nil, huma.Error409Conflict("DB name conflicts with a non-Brain KubeBlocks Cluster", err)
		}
		resources, err := orchestration.RenderDBResources(renderInput)
		if err != nil {
			return nil, huma.Error400BadRequest("invalid DB direct resource request", err)
		}
		if err := k8ssvc.ApplyUnstructured(restConfig, []*unstructured.Unstructured{resources.Cluster}, ns); err != nil {
			return nil, huma.Error500InternalServerError("failed to create DB", err)
		}
		if resources.ExportService != nil {
			if err := k8ssvc.ApplyObjects(restConfig, []runtime.Object{resources.ExportService}, ns); err != nil {
				return nil, huma.Error500InternalServerError("failed to create DB support resources", err)
			}
		} else if err := deleteDBExportServiceIfExists(cfg, name, ns); err != nil {
			return nil, huma.Error500InternalServerError("failed to create DB support resources", err)
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

		body, err := dbResponseFromClustersWithSupport(cfg, jsonBytes, true)
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
		CPULimit:       stringFromMap(spec, "cpuLimit"),
		CPURequest:     stringFromMap(spec, "cpuRequest"),
		ClusterVersion: version,
		Engine:         engine,
		ExposeNodePort: boolFromMap(spec, "exposeNodePort"),
		MemoryLimit:    stringFromMap(spec, "memoryLimit"),
		MemoryRequest:  stringFromMap(spec, "memoryRequest"),
		Name:           obj.GetName(),
		Namespace:      namespace,
		ProjectID:      projectID,
		Quota:          stringFromMap(spec, "quota"),
		Replicas:       int64FromMap(spec, "replicas"),
		StorageSize:    stringFromMap(spec, "storageSize"),
	}
}

func requireBrainDBCluster(cluster unstructured.Unstructured) error {
	return requireDBProviderCluster(cluster)
}

func requireDBProviderCluster(cluster unstructured.Unstructured) error {
	labels := cluster.GetLabels()
	if strings.TrimSpace(labels[orchestration.DBProviderInstanceLabel]) == "" ||
		strings.TrimSpace(labels[orchestration.DBProviderClusterDefinitionLabel]) == "" {
		return errors.New("cluster is not a DB Provider instance")
	}
	if labels[orchestration.BrainManagedByLabel] != orchestration.BrainManagedByValue ||
		strings.TrimSpace(labels[orchestration.BrainProjectIDLabel]) == "" {
		return errors.New("cluster is not a Brain-owned DB Provider instance")
	}
	return nil
}

func requireBrainDBLikeCluster(cluster unstructured.Unstructured) error {
	return requireDBProviderCluster(cluster)
}

func requireBrainDBLifecycleCluster(cluster unstructured.Unstructured) error {
	return requireBrainManagedDBProductCluster(cluster)
}

func requireBrainDBUpdateCluster(cluster unstructured.Unstructured) error {
	return requireBrainManagedDBProductCluster(cluster)
}

func requireBrainDBBackupPolicyCluster(cluster unstructured.Unstructured) error {
	return requireBrainManagedDBProductCluster(cluster)
}

func requireBrainManagedDBProductCluster(cluster unstructured.Unstructured) error {
	if err := requireBrainDBLikeCluster(cluster); err != nil {
		return err
	}
	if _, ok := orchestration.DBEngineProfileFor(dbEngineFromCluster(cluster)); !ok {
		return errors.New("cluster is not a supported Brain DB product")
	}
	return nil
}

func ensureDBCreateTargetIsBrainManaged(cfg *clientcmdapi.Config, name string, namespace string) error {
	clusterJSON, err := k8ssvc.Get(cfg, k8ssvc.GetOptions{
		Resource:  "clusters",
		Name:      name,
		Namespace: namespace,
	})
	if apierrors.IsNotFound(err) {
		return nil
	}
	if err != nil {
		return err
	}
	var current unstructured.Unstructured
	if err := json.Unmarshal(clusterJSON, &current); err != nil {
		return err
	}
	return requireBrainDBCluster(current)
}

func stringFromMap(values map[string]interface{}, key string) string {
	if values == nil {
		return ""
	}
	value, _ := values[key].(string)
	return strings.TrimSpace(value)
}

func boolFromMap(values map[string]interface{}, key string) bool {
	if values == nil {
		return false
	}
	value, _ := values[key].(bool)
	return value
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
		Name        string `json:"name" required:"true" doc:"DB instance name to create backup for"`
		BackupName  string `json:"backupName" required:"true" doc:"Backup Name for the Backup CR. Must be unique in the namespace and follow lowercase DNS-style Kubernetes naming rules."`
		Description string `json:"description,omitempty" maxLength:"120" doc:"Optional short description stored as backup metadata."`
		Namespace   string `json:"namespace,omitempty" doc:"Namespace (default from kubeconfig; admin can override)"`
	}
	type dbBackupDeleteBody struct {
		Name       string `json:"name" required:"true" doc:"Source DB Service name"`
		BackupName string `json:"backupName" required:"true" doc:"Backup Name to delete"`
		Namespace  string `json:"namespace,omitempty" doc:"Namespace (default from kubeconfig; admin can override)"`
	}
	type dbBackupInput struct {
		middleware.AuthInput
		Body dbBackupBody
	}
	type dbBackupDeleteInput struct {
		middleware.AuthInput
		Body dbBackupDeleteBody
	}
	type dbBackupOutput struct {
		Body json.RawMessage
	}
	type dbBackupDeleteOutput struct {
		Body dbsvc.DeleteBackupForDBResult
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
		resolved, err := middleware.ResolveContext(cfg, middleware.ResolveOptions{
			Namespace: input.Body.Namespace, DefaultNamespace: ""})
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to resolve namespace", err)
		}
		ns := resolved.Namespace

		jsonBytes, err := dbsvc.CreateBackupForDB(cfg, dbsvc.CreateBackupForDBOptions{
			DBName:      input.Body.Name,
			Namespace:   ns,
			BackupName:  input.Body.BackupName,
			Description: input.Body.Description,
		})
		if err != nil {
			return nil, backupCreateError(err)
		}
		return &dbBackupOutput{Body: json.RawMessage(jsonBytes)}, nil
	})

	huma.Register(grp, huma.Operation{
		OperationID: "db-backup-delete",
		Method:      http.MethodDelete,
		Path:        "/backup",
		Summary:     "Delete DB Service Backup",
		Description: "Delete one completed or failed DB Service Backup for a source DB Service.\n\n" +
			"Deletion is scoped to the selected Backup resource in the resolved namespace. The source DB Service and any DB Services restored from the backup are not deleted or modified. Backups that are pending, running, or already deleting are rejected.",
		Tags: []string{"DB"},
	}, func(ctx context.Context, input *dbBackupDeleteInput) (*dbBackupDeleteOutput, error) {
		_, cfg, err := middleware.RestConfigFromAuth(input.Authorization)
		if err != nil {
			return nil, huma.Error400BadRequest("invalid kubeconfig", err)
		}
		if strings.TrimSpace(input.Body.Name) == "" {
			return nil, huma.Error400BadRequest("name is required", nil)
		}
		if strings.TrimSpace(input.Body.BackupName) == "" {
			return nil, huma.Error400BadRequest("backupName is required", nil)
		}
		resolved, err := middleware.ResolveContext(cfg, middleware.ResolveOptions{
			Namespace: input.Body.Namespace, DefaultNamespace: ""})
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to resolve namespace", err)
		}

		result, err := dbsvc.DeleteBackupForDB(cfg, dbsvc.DeleteBackupForDBOptions{
			DBName:     input.Body.Name,
			Namespace:  resolved.Namespace,
			BackupName: input.Body.BackupName,
		})
		if err != nil {
			if apierrors.IsNotFound(err) {
				return nil, huma.Error404NotFound("DB Service Backup not found", err)
			}
			if errors.Is(err, dbsvc.ErrDBBackupNotDeletable) {
				return nil, huma.Error409Conflict("DB Service Backup is not deletable", err)
			}
			return nil, huma.Error500InternalServerError("failed to delete backup", err)
		}
		return &dbBackupDeleteOutput{Body: result}, nil
	})
}

func backupCreateError(err error) error {
	switch {
	case errors.Is(err, dbsvc.ErrBackupValidation):
		return huma.Error400BadRequest("invalid backup request", err)
	case errors.Is(err, dbsvc.ErrBackupSourceNotFound):
		return huma.Error404NotFound("DB not found", err)
	case errors.Is(err, dbsvc.ErrBackupSourceNotRunning):
		return huma.Error409Conflict("DB Service must be Running before creating a backup", err)
	case errors.Is(err, dbsvc.ErrBackupConflict):
		return huma.Error409Conflict("Backup Name already exists", err)
	case errors.Is(err, dbsvc.ErrBackupUnsupportedEngine):
		return huma.Error422UnprocessableEntity("unsupported DB engine for backup", err)
	default:
		return huma.Error500InternalServerError("failed to create backup", err)
	}
}

func registerRestore(grp huma.API) {
	type dbRestoreBody struct {
		BackupName      string `json:"backupName" required:"true" doc:"Completed DB Service Backup metadata.name to restore from"`
		BackupNamespace string `json:"backupNamespace,omitempty" doc:"Backup namespace; defaults to the source DB Service namespace"`
		Name            string `json:"name" required:"true" doc:"Source DB Service metadata.name. The source remains intact."`
		Namespace       string `json:"namespace,omitempty" doc:"Source DB Service namespace; default from kubeconfig; admin can override"`
		RestoredName    string `json:"restoredName" required:"true" doc:"New DB Service metadata.name. Must be lowercase DNS-style and unique in the namespace."`
	}
	type dbRestoreInput struct {
		middleware.AuthInput
		Body dbRestoreBody
	}
	type dbRestoreOutput struct {
		Body json.RawMessage
	}

	huma.Register(grp, huma.Operation{
		OperationID: "db-restore",
		Method:      http.MethodPost,
		Path:        "/restore",
		Summary:     "Restore DB Service Backup to a new DB Service",
		Description: "Restore from a completed DB Service Backup into a new DB Service in the same namespace and projectId as the source DB Service.\n\n" +
			"Restore never overwrites, rolls back, or modifies the source DB Service. The restored DB Service inherits the source DB Service database settings; restore-time CPU, memory, storage, replica, engine, version, and backup policy overrides are not accepted.",
		Tags: []string{"DB"},
	}, func(ctx context.Context, input *dbRestoreInput) (*dbRestoreOutput, error) {
		_, cfg, err := middleware.RestConfigFromAuth(input.Authorization)
		if err != nil {
			return nil, huma.Error400BadRequest("invalid kubeconfig", err)
		}
		sourceName := strings.TrimSpace(input.Body.Name)
		backupName := strings.TrimSpace(input.Body.BackupName)
		restoredName := strings.TrimSpace(input.Body.RestoredName)
		if sourceName == "" {
			return nil, huma.Error400BadRequest("name is required", nil)
		}
		if backupName == "" {
			return nil, huma.Error400BadRequest("backupName is required", nil)
		}
		if err := dbsvc.ValidateDBServiceName(restoredName); err != nil {
			return nil, huma.Error400BadRequest(err.Error(), err)
		}
		resolved, err := middleware.ResolveContext(cfg, middleware.ResolveOptions{
			Namespace: input.Body.Namespace, DefaultNamespace: ""})
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to resolve namespace", err)
		}
		jsonBytes, err := dbsvc.RestoreDBFromBackup(cfg, dbsvc.RestoreDBOptions{
			BackupName:      backupName,
			BackupNamespace: strings.TrimSpace(input.Body.BackupNamespace),
			Namespace:       resolved.Namespace,
			RestoredName:    restoredName,
			SourceName:      sourceName,
		})
		if err != nil {
			if apierrors.IsAlreadyExists(err) {
				return nil, huma.Error409Conflict("DB Service name already exists", err)
			}
			if apierrors.IsNotFound(err) {
				return nil, huma.Error404NotFound("DB Service or Backup not found", err)
			}
			if isDBRestoreValidationError(err) {
				return nil, huma.Error422UnprocessableEntity("invalid DB Service restore request", err)
			}
			return nil, huma.Error500InternalServerError("failed to restore DB Service", err)
		}
		return &dbRestoreOutput{Body: json.RawMessage(jsonBytes)}, nil
	})
}

func isDBRestoreValidationError(err error) bool {
	if err == nil {
		return false
	}
	message := err.Error()
	for _, fragment := range dbRestoreValidationErrorFragments {
		if strings.Contains(message, fragment) {
			return true
		}
	}
	return false
}

type dbBackupPolicyRequest struct {
	CronExpression string `json:"cronExpression,omitempty" doc:"UTC cron expression for the automatic DB Service Backup Policy."`
	Enabled        bool   `json:"enabled" doc:"Whether future automatic DB Service Backups should run."`
	Name           string `json:"name" required:"true" doc:"DB metadata.name."`
	Namespace      string `json:"namespace,omitempty" doc:"Namespace of the DB (default from kubeconfig; admin can override)."`
	RetentionDays  int64  `json:"retentionDays,omitempty" doc:"Automatic backup retention in days. Allowed values: 1, 3, 7, 14, or 30."`
}

type dbBackupPolicyCronFields struct {
	dayOfMonth string
	hour       string
	minute     string
	month      string
	weekday    string
}

func registerBackupPolicy(grp huma.API) {
	type dbBackupPolicyInput struct {
		middleware.AuthInput
		Body dbBackupPolicyRequest
	}
	type dbBackupPolicyOutput struct {
		Body json.RawMessage
	}

	huma.Register(grp, huma.Operation{
		OperationID: "db-backup-policy-update",
		Method:      http.MethodPost,
		Path:        "/backup/policy",
		Summary:     "Update DB backup policy",
		Description: "Updates the single current automatic DB Service Backup Policy for a DB Service by patching the backing KubeBlocks Cluster `spec.backup` fields. Disabling the policy stops future automatic backups and preserves existing DB Service Backup resources.",
		Tags:        []string{"DB"},
	}, func(ctx context.Context, input *dbBackupPolicyInput) (*dbBackupPolicyOutput, error) {
		_, cfg, err := middleware.RestConfigFromAuth(input.Authorization)
		if err != nil {
			return nil, huma.Error400BadRequest("invalid kubeconfig", err)
		}
		name := strings.TrimSpace(input.Body.Name)
		if name == "" {
			return nil, huma.Error400BadRequest("name is required", nil)
		}
		resolved, err := middleware.ResolveContext(cfg, middleware.ResolveOptions{
			Namespace: input.Body.Namespace, DefaultNamespace: ""})
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to resolve request context", err)
		}

		clusterJSON, err := k8ssvc.Get(cfg, k8ssvc.GetOptions{
			Resource:  "clusters",
			Name:      name,
			Namespace: resolved.Namespace,
		})
		if err != nil {
			if apierrors.IsNotFound(err) {
				return nil, huma.Error404NotFound("DB not found", err)
			}
			return nil, huma.Error500InternalServerError("failed to get DB for backup policy update", err)
		}
		var currentCluster unstructured.Unstructured
		if err := json.Unmarshal(clusterJSON, &currentCluster); err != nil {
			return nil, huma.Error500InternalServerError("failed to decode DB for backup policy update", err)
		}
		if err := requireBrainDBBackupPolicyCluster(currentCluster); err != nil {
			return nil, huma.Error404NotFound("DB not found", err)
		}

		patch, err := dbBackupPolicyPatchFromRequest(input.Body, dbEngineFromCluster(currentCluster), dbBackupRepoName(currentCluster))
		if err != nil {
			return nil, huma.Error422UnprocessableEntity("invalid DB backup policy request", err)
		}
		patchedJSON, err := k8ssvc.Patch(cfg, k8ssvc.PatchOptions{
			Resource:  "clusters",
			Name:      name,
			Namespace: resolved.Namespace,
			PatchType: k8ssvc.PatchTypeMerge,
			Patch:     patch,
		})
		if err != nil {
			if apierrors.IsNotFound(err) {
				return nil, huma.Error404NotFound("DB not found", err)
			}
			return nil, huma.Error500InternalServerError("failed to update DB backup policy", err)
		}
		body, err := dbResponseFromClustersWithSupport(cfg, patchedJSON, true)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to adapt DB response", err)
		}
		return &dbBackupPolicyOutput{Body: body}, nil
	})
}

func dbBackupPolicyPatchFromRequest(request dbBackupPolicyRequest, engine string, repoName string) ([]byte, error) {
	backup := map[string]interface{}{
		"enabled": request.Enabled,
	}
	if request.Enabled {
		cronExpression := strings.TrimSpace(request.CronExpression)
		if cronExpression == "" {
			return nil, fmt.Errorf("cronExpression is required when enabled is true")
		}
		if !isSupportedDBBackupPolicyCron(cronExpression) {
			return nil, fmt.Errorf("cronExpression must be an hourly, daily, or weekly schedule")
		}
		if !isAllowedRetentionDays(request.RetentionDays) {
			return nil, fmt.Errorf("retentionDays must be one of 1, 3, 7, 14, or 30")
		}
		profile, ok := orchestration.DBEngineProfileFor(engine)
		if !ok {
			return nil, fmt.Errorf("unsupported DB engine %q", engine)
		}
		backup["cronExpression"] = cronExpression
		backup["incrementalBackupEnabled"] = false
		backup["method"] = profile.BackupMethod
		backup["pitrEnabled"] = false
		if patchValue, ok := dbBackupPolicyRepoPatchValue(repoName); ok {
			backup["repoName"] = patchValue
		}
		backup["retentionPeriod"] = fmt.Sprintf("%dd", request.RetentionDays)
	}
	return json.Marshal(map[string]interface{}{
		"spec": map[string]interface{}{
			"backup": backup,
		},
	})
}

func isSupportedDBBackupPolicyCron(cronExpression string) bool {
	fields, ok := dbBackupPolicyCronFieldsFromExpression(cronExpression)
	if !ok {
		return false
	}
	return isHourlyDBBackupPolicyCron(fields) ||
		isDailyDBBackupPolicyCron(fields) ||
		isWeeklyDBBackupPolicyCron(fields)
}

func dbBackupPolicyCronFieldsFromExpression(cronExpression string) (dbBackupPolicyCronFields, bool) {
	fields := strings.Fields(strings.TrimSpace(cronExpression))
	if len(fields) != 5 {
		return dbBackupPolicyCronFields{}, false
	}
	return dbBackupPolicyCronFields{
		minute:     fields[0],
		hour:       fields[1],
		dayOfMonth: fields[2],
		month:      fields[3],
		weekday:    fields[4],
	}, true
}

func isHourlyDBBackupPolicyCron(fields dbBackupPolicyCronFields) bool {
	return isCronNumberInRange(fields.minute, 0, 59) &&
		fields.hour == "*" &&
		fields.dayOfMonth == "*" &&
		fields.month == "*" &&
		fields.weekday == "*"
}

func isDailyDBBackupPolicyCron(fields dbBackupPolicyCronFields) bool {
	return isCronNumberInRange(fields.minute, 0, 59) &&
		isCronNumberInRange(fields.hour, 0, 23) &&
		fields.dayOfMonth == "*" &&
		fields.month == "*" &&
		fields.weekday == "*"
}

func isWeeklyDBBackupPolicyCron(fields dbBackupPolicyCronFields) bool {
	return isCronNumberInRange(fields.minute, 0, 59) &&
		isCronNumberInRange(fields.hour, 0, 23) &&
		fields.dayOfMonth == "*" &&
		fields.month == "*" &&
		isCronWeekdayList(fields.weekday)
}

func isCronNumberInRange(value string, min, max int) bool {
	if value == "" {
		return false
	}
	var parsed int
	for _, char := range value {
		if char < '0' || char > '9' {
			return false
		}
		parsed = parsed*10 + int(char-'0')
	}
	return parsed >= min && parsed <= max
}

func isCronWeekdayList(value string) bool {
	if value == "" || value == "*" {
		return false
	}
	seen := map[string]bool{}
	for _, part := range strings.Split(value, ",") {
		if !isCronNumberInRange(part, 0, 6) || seen[part] {
			return false
		}
		seen[part] = true
	}
	return true
}

func dbBackupRepoName(cluster unstructured.Unstructured) string {
	repoName, _, _ := unstructured.NestedString(cluster.Object, "spec", "backup", "repoName")
	return strings.TrimSpace(repoName)
}

func dbBackupPolicyRepoPatchValue(repoName string) (interface{}, bool) {
	repoName = strings.TrimSpace(repoName)
	if repoName == "" {
		return nil, false
	}
	if repoName == "backuprepo-s3" {
		return nil, true
	}
	return repoName, true
}

func isAllowedRetentionDays(days int64) bool {
	switch days {
	case 1, 3, 7, 14, 30:
		return true
	default:
		return false
	}
}

type dbLifecycleBody struct {
	Name      string `json:"name" required:"true" doc:"DB metadata.name."`
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
		Description: "Starts a DB by creating a KubeBlocks Start OpsRequest. If the Cluster has spec.backup.enabled=false, the API restores it to true like Sealos dbprovider.",
		Tags:        []string{"DB"},
	}, func(ctx context.Context, input *dbLifecycleInput) (*dbLifecycleOutput, error) {
		return applyLifecycleDBOps(input, "Start")
	})
}

func registerStop(grp huma.API) {
	huma.Register(grp, huma.Operation{
		OperationID: "db-stop",
		Method:      http.MethodPost,
		Path:        "/stop",
		Summary:     "Stop DB workload",
		Description: "Stops a DB by deleting the export Service when present, disabling Cluster backup when present, and creating a KubeBlocks Stop OpsRequest. Data and configuration are preserved.",
		Tags:        []string{"DB"},
	}, func(ctx context.Context, input *dbLifecycleInput) (*dbLifecycleOutput, error) {
		return applyLifecycleDBOps(input, "Stop")
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
		return applyLifecycleDBOps(input, "Restart")
	})
}

func dbEngineFromClusterJSON(clusterJSON []byte) string {
	var cluster unstructured.Unstructured
	if err := json.Unmarshal(clusterJSON, &cluster); err != nil {
		return ""
	}
	return dbEngineFromCluster(cluster)
}

func dbEngineFromCluster(cluster unstructured.Unstructured) string {
	engine := strings.TrimSpace(cluster.GetLabels()[orchestration.BrainDBEngineLabel])
	if engine != "" {
		return engine
	}
	if definition := strings.TrimSpace(cluster.GetLabels()[orchestration.DBProviderClusterDefinitionLabel]); definition != "" {
		return definition
	}
	if value, _, _ := unstructured.NestedString(cluster.Object, "spec", "clusterDefinitionRef"); value != "" {
		return value
	}
	return ""
}

func isKubeBlocksOpsConflict(err error) bool {
	if err == nil {
		return false
	}
	message := err.Error()
	return strings.Contains(message, "OpsRequest.spec.type=") ||
		strings.Contains(message, "Cluster.status.phase")
}

func applyLifecycleDBOps(input *dbLifecycleInput, opsType string) (*dbLifecycleOutput, error) {
	restConfig, cfg, name, namespace, err := lifecycleDBContext(input)
	if err != nil {
		return nil, err
	}

	clusterJSON, err := k8ssvc.Get(cfg, k8ssvc.GetOptions{
		Resource:  "clusters",
		Name:      name,
		Namespace: namespace,
	})
	if err != nil {
		if apierrors.IsNotFound(err) {
			return nil, huma.Error404NotFound("DB not found", err)
		}
		return nil, huma.Error500InternalServerError("failed to get DB for "+strings.ToLower(opsType), err)
	}
	var currentCluster unstructured.Unstructured
	if err := json.Unmarshal(clusterJSON, &currentCluster); err != nil {
		return nil, huma.Error500InternalServerError("failed to decode DB for "+strings.ToLower(opsType), err)
	}
	if err := requireBrainDBLifecycleCluster(currentCluster); err != nil {
		return nil, huma.Error404NotFound("DB not found", err)
	}

	if opsType == "Stop" {
		if err := deleteDBExportServiceIfExists(cfg, name, namespace); err != nil {
			return nil, huma.Error500InternalServerError("failed to stop DB support resources", err)
		}
		if err := patchDBBackupEnabledIfPresent(cfg, clusterJSON, name, namespace, false); err != nil {
			return nil, huma.Error500InternalServerError("failed to stop DB backup policy", err)
		}
	} else if opsType == "Start" {
		if err := patchDBBackupEnabledIfPresent(cfg, clusterJSON, name, namespace, true); err != nil {
			return nil, huma.Error500InternalServerError("failed to start DB backup policy", err)
		}
	}

	engine := dbEngineFromClusterJSON(clusterJSON)
	ops, err := orchestration.RenderDBBasicOpsRequest(name, namespace, engine, opsType, time.Now())
	if err != nil {
		return nil, huma.Error422UnprocessableEntity("invalid DB "+strings.ToLower(opsType)+" request", err)
	}
	if err := k8ssvc.ApplyUnstructured(restConfig, []*unstructured.Unstructured{ops}, namespace); err != nil {
		if isKubeBlocksOpsConflict(err) {
			return nil, huma.Error409Conflict("DB is not ready to "+strings.ToLower(opsType), err)
		}
		return nil, huma.Error500InternalServerError("failed to "+strings.ToLower(opsType)+" DB", err)
	}
	body, _ := json.Marshal(ops.Object)
	return &dbLifecycleOutput{Body: body}, nil
}

func patchDBBackupEnabledIfPresent(cfg *clientcmdapi.Config, clusterJSON []byte, name, namespace string, enabled bool) error {
	var cluster unstructured.Unstructured
	if err := json.Unmarshal(clusterJSON, &cluster); err != nil {
		return err
	}
	current, found, err := unstructured.NestedBool(cluster.Object, "spec", "backup", "enabled")
	if err != nil || !found || current == enabled {
		return err
	}
	patch, _ := json.Marshal(map[string]interface{}{
		"spec": map[string]interface{}{
			"backup": map[string]interface{}{
				"enabled": enabled,
			},
		},
	})
	_, err = k8ssvc.Patch(cfg, k8ssvc.PatchOptions{
		Resource:  "clusters",
		Name:      name,
		Namespace: namespace,
		PatchType: k8ssvc.PatchTypeMerge,
		Patch:     patch,
	})
	return err
}

func lifecycleDBContext(input *dbLifecycleInput) (*rest.Config, *clientcmdapi.Config, string, string, error) {
	restConfig, cfg, err := middleware.RestConfigFromAuth(input.Authorization)
	if err != nil {
		return nil, nil, "", "", huma.Error400BadRequest("invalid kubeconfig", err)
	}
	name := strings.TrimSpace(input.Body.Name)
	if name == "" {
		return nil, nil, "", "", huma.Error400BadRequest("name is required", nil)
	}
	resolved, err := middleware.ResolveContext(cfg, middleware.ResolveOptions{
		Namespace: input.Body.Namespace, DefaultNamespace: ""})
	if err != nil {
		return nil, nil, "", "", huma.Error500InternalServerError("failed to resolve request context", err)
	}
	return restConfig, cfg, name, resolved.Namespace, nil
}

func registerUpdate(grp huma.API) {
	type dbUpdateInput struct {
		middleware.AuthInput
		Name      string          `query:"name" required:"true" doc:"DB instance name to patch"`
		Namespace string          `query:"namespace" doc:"Namespace (default from kubeconfig; admin can override)"`
		Body      json.RawMessage `contentType:"application/json" required:"true" doc:"JSON merge patch body applied to the DB product surface.\n\nSupported patch targets:\n- spec.replicas: creates a KubeBlocks HorizontalScaling OpsRequest.\n- spec.paused: creates a KubeBlocks Stop or Start OpsRequest.\n- spec.restartRequest: creates a KubeBlocks Restart OpsRequest; prefer POST /restart.\n- spec.storageSize: creates a KubeBlocks VolumeExpansion OpsRequest when the desired size increases.\n- spec.cpuRequest / spec.memoryRequest: creates a KubeBlocks VerticalScaling OpsRequest.\n- spec.cpuLimit / spec.memoryLimit: creates a KubeBlocks VerticalScaling OpsRequest.\n- spec.terminationPolicy: patches the KubeBlocks Cluster management policy.\n- spec.exposeNodePort: applies or deletes Service {name}-export.\n\nUnsupported for now and rejected with 422: spec.quota, spec.storageClassName, spec.clusterVersion, spec.version, spec.scheduledBackup, spec.parameterConfig, spec.restoreFromBackup.\n\nPatch examples:\n- Stop: {\"spec\":{\"paused\":true}}\n- Start: {\"spec\":{\"paused\":false}}\n- Scale replicas: {\"spec\":{\"replicas\":2}}\n- Expose via NodePort: {\"spec\":{\"exposeNodePort\":true}}\n- Update resources: {\"spec\":{\"cpuLimit\":\"2000m\",\"memoryLimit\":\"4Gi\"}}\n- Expand storage: {\"spec\":{\"storageSize\":\"20Gi\"}}\n\nPatch semantics:\n- Only the fields you send are changed.\n- Runtime operations are expressed as KubeBlocks OpsRequest CRs, not direct Cluster componentSpec rewrites."`
	}
	type dbUpdateOutput struct {
		Body json.RawMessage
	}

	huma.Register(grp, huma.Operation{
		OperationID: "db-update",
		Method:      http.MethodPatch,
		Path:        "/",
		Summary:     "Update DB",
		Description: "Patch a DB instance by name.\n\nRequest parameter usage:\n- `name` is required and selects the DB to patch.\n- `namespace` is optional; admins can use it to target a different namespace.\n- The request body must be a JSON merge patch fragment for the DB product surface.\n\nPatch semantics:\n- Runtime changes create KubeBlocks OpsRequest CRs, following the Sealos dbprovider model.\n- `spec.replicas` creates HorizontalScaling.\n- `spec.storageSize` creates VolumeExpansion when increasing size.\n- `spec.cpuRequest`, `spec.memoryRequest`, `spec.cpuLimit`, and `spec.memoryLimit` create VerticalScaling.\n- `spec.paused` creates Stop or Start.\n- `spec.restartRequest` creates Restart; prefer `POST /api/db/v1alpha1/restart`.\n- `spec.exposeNodePort` toggles Service `{metadata.name}-export`.\n- `spec.terminationPolicy` is patched directly on the Cluster management policy.\n\nUnsupported fields are rejected with 422 so callers do not silently get a partial update.",
		Tags:        []string{"DB"},
	}, func(ctx context.Context, input *dbUpdateInput) (*dbUpdateOutput, error) {
		restConfig, cfg, err := middleware.RestConfigFromAuth(input.Authorization)
		if err != nil {
			return nil, huma.Error400BadRequest("invalid kubeconfig", err)
		}
		if input.Name == "" {
			return nil, huma.Error400BadRequest("name is required", nil)
		}
		if len(input.Body) == 0 {
			return nil, huma.Error400BadRequest("patch body is required", nil)
		}
		resolved, err := middleware.ResolveContext(cfg, middleware.ResolveOptions{
			Namespace: input.Namespace, DefaultNamespace: ""})
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to resolve request context", err)
		}

		clusterJSON, err := k8ssvc.Get(cfg, k8ssvc.GetOptions{
			Resource:  "clusters",
			Name:      input.Name,
			Namespace: resolved.Namespace,
		})
		if err != nil {
			if apierrors.IsNotFound(err) {
				return nil, huma.Error404NotFound("DB not found", err)
			}
			return nil, huma.Error500InternalServerError("failed to get DB for update", err)
		}
		var currentCluster unstructured.Unstructured
		if err := json.Unmarshal(clusterJSON, &currentCluster); err != nil {
			return nil, huma.Error500InternalServerError("failed to decode DB for update", err)
		}
		if err := requireBrainDBUpdateCluster(currentCluster); err != nil {
			return nil, huma.Error404NotFound("DB not found", err)
		}

		plan, err := dbUpdatePlanFromProductPatch(input.Body, clusterJSON, input.Name, resolved.Namespace, time.Now())
		if err != nil {
			return nil, huma.Error422UnprocessableEntity("invalid DB product patch", err)
		}
		jsonBytes := clusterJSON
		if lifecycle, found := pausedPatchValue(input.Body); found {
			if lifecycle == "Stop" {
				if err := deleteDBExportServiceIfExists(cfg, input.Name, resolved.Namespace); err != nil {
					return nil, huma.Error500InternalServerError("failed to update DB support resources", err)
				}
				if err := patchDBBackupEnabledIfPresent(cfg, clusterJSON, input.Name, resolved.Namespace, false); err != nil {
					return nil, huma.Error500InternalServerError("failed to update DB backup policy", err)
				}
			} else if err := patchDBBackupEnabledIfPresent(cfg, clusterJSON, input.Name, resolved.Namespace, true); err != nil {
				return nil, huma.Error500InternalServerError("failed to update DB backup policy", err)
			}
		}
		if plan.HasClusterPatch {
			jsonBytes, err = k8ssvc.Patch(cfg, k8ssvc.PatchOptions{
				Resource:  "clusters",
				Name:      input.Name,
				Namespace: resolved.Namespace,
				PatchType: k8ssvc.PatchTypeMerge,
				Patch:     plan.ClusterPatch,
			})
			if err != nil {
				if apierrors.IsNotFound(err) {
					return nil, huma.Error404NotFound("DB not found", err)
				}
				return nil, huma.Error500InternalServerError("failed to update DB", err)
			}
		}
		if len(plan.OpsRequests) > 0 {
			if err := k8ssvc.ApplyUnstructured(restConfig, plan.OpsRequests, resolved.Namespace); err != nil {
				if isKubeBlocksOpsConflict(err) {
					return nil, huma.Error409Conflict("DB is not ready for DB operation", err)
				}
				return nil, huma.Error500InternalServerError("failed to update DB", err)
			}
		}
		if err := reconcileDBPublicAccess(restConfig, cfg, input.Body, jsonBytes, input.Name, resolved.Namespace); err != nil {
			return nil, huma.Error500InternalServerError("failed to update DB support resources", err)
		}
		body, err := dbResponseFromClustersWithSupport(cfg, jsonBytes, true)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to adapt DB response", err)
		}
		return &dbUpdateOutput{Body: body}, nil
	})
}

type dbUpdatePlan struct {
	ClusterPatch    []byte
	HasClusterPatch bool
	OpsRequests     []*unstructured.Unstructured
}

func dbUpdatePlanFromProductPatch(patch []byte, clusterJSON []byte, name string, namespace string, now time.Time) (dbUpdatePlan, error) {
	var body map[string]interface{}
	if err := json.Unmarshal(patch, &body); err != nil {
		return dbUpdatePlan{}, err
	}
	specPatch, _ := body["spec"].(map[string]interface{})
	if len(specPatch) == 0 {
		return dbUpdatePlan{}, nil
	}

	var cluster unstructured.Unstructured
	if err := json.Unmarshal(clusterJSON, &cluster); err != nil {
		return dbUpdatePlan{}, err
	}
	engine := dbEngineFromCluster(cluster)

	mergeSpec := map[string]interface{}{}
	vertical := orchestration.DBVerticalScalingInput{}
	needsVertical := false
	plan := dbUpdatePlan{}

	for key, raw := range specPatch {
		switch key {
		case "exposeNodePort":
			if _, ok := raw.(bool); !ok {
				return dbUpdatePlan{}, fmt.Errorf("spec.exposeNodePort must be boolean")
			}
		case "paused":
			value, ok := raw.(bool)
			if !ok {
				return dbUpdatePlan{}, fmt.Errorf("spec.paused must be boolean")
			}
			opsType := "Start"
			if value {
				opsType = "Stop"
			}
			ops, err := orchestration.RenderDBBasicOpsRequest(name, namespace, engine, opsType, now)
			if err != nil {
				return dbUpdatePlan{}, err
			}
			plan.OpsRequests = append(plan.OpsRequests, ops)
		case "restartRequest":
			value, ok := int64Value(raw)
			if !ok || value < 0 {
				return dbUpdatePlan{}, fmt.Errorf("spec.restartRequest must be a non-negative integer")
			}
			ops, err := orchestration.RenderDBBasicOpsRequest(name, namespace, engine, "Restart", now)
			if err != nil {
				return dbUpdatePlan{}, err
			}
			plan.OpsRequests = append(plan.OpsRequests, ops)
		case "terminationPolicy":
			value, ok := stringValue(raw)
			if !ok {
				return dbUpdatePlan{}, fmt.Errorf("spec.terminationPolicy must be string")
			}
			mergeSpec["terminationPolicy"] = value
		case "replicas":
			value, ok := int64Value(raw)
			if !ok || value < 1 {
				return dbUpdatePlan{}, fmt.Errorf("spec.replicas must be a positive integer")
			}
			ops, err := orchestration.RenderDBHorizontalScalingOpsRequest(name, namespace, engine, value, now)
			if err != nil {
				return dbUpdatePlan{}, err
			}
			plan.OpsRequests = append(plan.OpsRequests, ops)
		case "storageSize":
			value, ok := stringValue(raw)
			if !ok {
				return dbUpdatePlan{}, fmt.Errorf("spec.storageSize must be string")
			}
			shouldExpand, err := shouldRenderDBVolumeExpansion(cluster, value)
			if err != nil {
				return dbUpdatePlan{}, err
			}
			if shouldExpand {
				ops, err := orchestration.RenderDBVolumeExpansionOpsRequest(name, namespace, engine, value, now)
				if err != nil {
					return dbUpdatePlan{}, err
				}
				plan.OpsRequests = append(plan.OpsRequests, ops)
			}
		case "cpuRequest":
			value, err := quantityString(raw, "spec.cpuRequest")
			if err != nil {
				return dbUpdatePlan{}, err
			}
			vertical.CPURequest = value
			needsVertical = true
		case "memoryRequest":
			value, err := quantityString(raw, "spec.memoryRequest")
			if err != nil {
				return dbUpdatePlan{}, err
			}
			vertical.MemoryRequest = value
			needsVertical = true
		case "cpuLimit":
			value, err := quantityString(raw, "spec.cpuLimit")
			if err != nil {
				return dbUpdatePlan{}, err
			}
			vertical.CPULimit = value
			needsVertical = true
		case "memoryLimit":
			value, err := quantityString(raw, "spec.memoryLimit")
			if err != nil {
				return dbUpdatePlan{}, err
			}
			vertical.MemoryLimit = value
			needsVertical = true
		case "clusterVersion", "version", "quota", "storageClassName", "scheduledBackup", "parameterConfig", "restoreFromBackup":
			return dbUpdatePlan{}, fmt.Errorf("unsupported DB product patch field spec.%s", key)
		default:
			return dbUpdatePlan{}, fmt.Errorf("unsupported DB product patch field spec.%s", key)
		}
	}

	if needsVertical {
		ops, err := orchestration.RenderDBVerticalScalingOpsRequest(name, namespace, engine, vertical, now)
		if err != nil {
			return dbUpdatePlan{}, err
		}
		plan.OpsRequests = append(plan.OpsRequests, ops)
	}
	if len(mergeSpec) > 0 {
		bytes, err := json.Marshal(map[string]interface{}{"spec": mergeSpec})
		if err != nil {
			return dbUpdatePlan{}, err
		}
		plan.ClusterPatch = bytes
		plan.HasClusterPatch = true
	}
	return plan, nil
}

func quantityString(value interface{}, field string) (string, error) {
	str, ok := stringValue(value)
	if !ok {
		return "", fmt.Errorf("%s must be string", field)
	}
	if _, err := resource.ParseQuantity(str); err != nil {
		return "", fmt.Errorf("%s must be a Kubernetes quantity: %w", field, err)
	}
	return str, nil
}

func shouldRenderDBVolumeExpansion(cluster unstructured.Unstructured, desiredStorage string) (bool, error) {
	desired, err := resource.ParseQuantity(desiredStorage)
	if err != nil {
		return false, fmt.Errorf("spec.storageSize must be a Kubernetes quantity: %w", err)
	}
	currentStorage, found := clusterStorageSize(cluster)
	if !found {
		return true, nil
	}
	current, err := resource.ParseQuantity(currentStorage)
	if err != nil {
		return false, fmt.Errorf("current DB storage is invalid: %w", err)
	}
	cmp := desired.Cmp(current)
	if cmp < 0 {
		return false, fmt.Errorf("spec.storageSize cannot be decreased")
	}
	return cmp > 0, nil
}

func clusterStorageSize(cluster unstructured.Unstructured) (string, bool) {
	components, found, _ := unstructured.NestedSlice(cluster.Object, "spec", "componentSpecs")
	if !found || len(components) == 0 {
		return "", false
	}
	component, ok := components[0].(map[string]interface{})
	if !ok {
		return "", false
	}
	templates, found, _ := unstructured.NestedSlice(component, "volumeClaimTemplates")
	if !found || len(templates) == 0 {
		return "", false
	}
	template, ok := templates[0].(map[string]interface{})
	if !ok {
		return "", false
	}
	value, found, _ := unstructured.NestedString(template, "spec", "resources", "requests", "storage")
	return value, found
}

func stringValue(value interface{}) (string, bool) {
	str, ok := value.(string)
	str = strings.TrimSpace(str)
	return str, ok && str != ""
}

func int64Value(value interface{}) (int64, bool) {
	switch v := value.(type) {
	case int:
		return int64(v), true
	case int32:
		return int64(v), true
	case int64:
		return v, true
	case float64:
		i := int64(v)
		return i, v == float64(i)
	default:
		return 0, false
	}
}

func reconcileDBPublicAccess(restConfig *rest.Config, cfg *clientcmdapi.Config, patch []byte, clusterJSON []byte, name string, namespace string) error {
	desired, found := exposeNodePortPatchValue(patch)
	if !found {
		return nil
	}
	if !desired {
		return deleteDBExportServiceIfExists(cfg, name, namespace)
	}

	var cluster unstructured.Unstructured
	if err := json.Unmarshal(clusterJSON, &cluster); err != nil {
		return err
	}
	engine := strings.TrimSpace(cluster.GetLabels()[orchestration.BrainDBEngineLabel])
	if engine == "" {
		engine = strings.TrimSpace(cluster.GetLabels()[orchestration.DBProviderClusterDefinitionLabel])
	}
	if engine == "" {
		engine = "postgresql"
	}
	service := orchestration.RenderDBExportService(name, namespace, engine, cluster.GetLabels())
	return k8ssvc.ApplyObjects(restConfig, []runtime.Object{service}, namespace)
}

func exposeNodePortPatchValue(patch []byte) (bool, bool) {
	var body map[string]interface{}
	if err := json.Unmarshal(patch, &body); err != nil {
		return false, false
	}
	spec, _ := body["spec"].(map[string]interface{})
	value, ok := spec["exposeNodePort"].(bool)
	return value, ok
}

func pausedPatchValue(patch []byte) (string, bool) {
	var body map[string]interface{}
	if err := json.Unmarshal(patch, &body); err != nil {
		return "", false
	}
	spec, _ := body["spec"].(map[string]interface{})
	value, ok := spec["paused"].(bool)
	if !ok {
		return "", false
	}
	if value {
		return "Stop", true
	}
	return "Start", true
}

func deleteDBExportServiceIfExists(cfg *clientcmdapi.Config, name string, namespace string) error {
	_, err := k8ssvc.Delete(cfg, k8ssvc.DeleteOptions{
		Name:      name + "-export",
		Namespace: namespace,
		Resource:  "services",
	})
	if err != nil && !apierrors.IsNotFound(err) {
		return err
	}
	return nil
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
		resolved, err := middleware.ResolveContext(cfg, middleware.ResolveOptions{
			Namespace: input.Namespace, DefaultNamespace: ""})
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
	clusterJSON, err := k8ssvc.Get(cfg, k8ssvc.GetOptions{
		Resource:  "clusters",
		Name:      name,
		Namespace: namespace,
	})
	if err != nil {
		return err
	}
	var current unstructured.Unstructured
	if err := json.Unmarshal(clusterJSON, &current); err != nil {
		return err
	}
	if err := requireBrainDBCluster(current); err != nil {
		if templateRef, ok := templateDeploymentRefFromDBCluster(current); ok {
			return deleteTemplateDeploymentResources(cfg, templateRef, namespace)
		}
		return apierrors.NewNotFound(schema.GroupResource{Group: "apps.kubeblocks.io", Resource: "clusters"}, name)
	}
	selector := orchestration.BrainManagedByLabel + "=" + orchestration.BrainManagedByValue + "," + orchestration.BrainDeploymentKindLabel + "=" + orchestration.DeploymentKindDB + "," + orchestration.BrainDeploymentNameLabel + "=" + name
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
	_, err = k8ssvc.Delete(cfg, k8ssvc.DeleteOptions{
		Name:      name,
		Namespace: namespace,
		Resource:  "clusters",
	})
	if err != nil && apierrors.IsNotFound(err) {
		return nil
	}
	return err
}

func templateDeploymentRefFromDBCluster(cluster unstructured.Unstructured) (templateDeploymentRef, bool) {
	labels := cluster.GetLabels()
	if labels[orchestration.BrainDeploymentKindLabel] != orchestration.DeploymentKindTemplate {
		return templateDeploymentRef{}, false
	}
	name := strings.TrimSpace(labels[orchestration.BrainDeploymentNameLabel])
	projectID := strings.TrimSpace(labels[orchestration.BrainProjectIDLabel])
	return templateDeploymentRef{Name: name, ProjectID: projectID}, name != "" && projectID != ""
}
