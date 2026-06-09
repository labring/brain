package db

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/util/validation"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/rest"
	clientcmdapi "k8s.io/client-go/tools/clientcmd/api"

	"sealos/api/middleware"
	"sealos/api/service/orchestration"
	transformdb "sealos/api/service/transform/db"
)

const (
	backupDescriptionAnnotation = "brain.io/description"
	backupTypeAnnotation        = "brain.io/backup-type"
	manualBackupType            = "manual"
	maxBackupDescriptionRunes   = 120
)

var (
	ErrBackupConflict          = errors.New("backup name already exists")
	ErrBackupSourceNotFound    = errors.New("source DB Service not found")
	ErrBackupSourceNotRunning  = errors.New("source DB Service is not Running")
	ErrBackupUnsupportedEngine = errors.New("unsupported DB engine for backup")
	ErrBackupValidation        = errors.New("invalid backup request")
	ErrDBBackupNotDeletable    = errors.New("DB Service Backup is not deletable")
)

// CreateBackupForDBOptions holds options for creating an on-demand backup for a DB.
type CreateBackupForDBOptions struct {
	DBName      string // DB instance name (cluster has same name)
	Namespace   string // Namespace
	BackupName  string // Name for the Backup CR
	Description string // Optional user description stored in metadata annotations
}

// DeleteBackupForDBOptions holds options for deleting one DB Service Backup.
type DeleteBackupForDBOptions struct {
	DBName     string // Source DB Service name (cluster has same name)
	Namespace  string // Namespace
	BackupName string // Backup CR metadata.name
}

// DeleteBackupForDBResult is the stable API result for a backup delete request.
type DeleteBackupForDBResult struct {
	BackupName   string `json:"backupName"`
	Namespace    string `json:"namespace"`
	SourceDBName string `json:"sourceDbName"`
	Status       string `json:"status"`
}

type backupDynamicClientFunc func(*clientcmdapi.Config, string) (dynamic.Interface, string, error)

var backupDynamicClientFactory backupDynamicClientFunc = defaultBackupDynamicClientFactory

// CreateBackupForDB creates an on-demand KubeBlocks Backup for the given DB.
// The DB must have a running KubeBlocks Cluster.
// For PostgreSQL uses postgres-basebackup; MySQL xtrabackup; MongoDB mongodb-dump; Redis datafile (match Cluster.spec.backup.method).
func CreateBackupForDB(cfg *clientcmdapi.Config, opts CreateBackupForDBOptions) ([]byte, error) {
	if cfg == nil {
		return nil, fmt.Errorf("%w: kubeconfig is required", ErrBackupValidation)
	}
	client, ns, err := backupDynamicClientFactory(cfg, opts.Namespace)
	if err != nil {
		return nil, err
	}
	opts.Namespace = ns
	return createBackupForDBWithClient(context.Background(), client, opts)
}

func defaultBackupDynamicClientFactory(cfg *clientcmdapi.Config, ns string) (dynamic.Interface, string, error) {
	restConfig, resolvedNamespace, err := restConfigAndNamespaceForDBBackup(cfg, ns)
	if err != nil {
		return nil, "", err
	}
	client, err := dynamic.NewForConfig(restConfig)
	if err != nil {
		return nil, "", err
	}
	return client, resolvedNamespace, nil
}

func createBackupForDBWithClient(ctx context.Context, client dynamic.Interface, opts CreateBackupForDBOptions) ([]byte, error) {
	opts.DBName = strings.TrimSpace(opts.DBName)
	opts.Namespace = strings.TrimSpace(opts.Namespace)
	opts.BackupName = strings.TrimSpace(opts.BackupName)
	opts.Description = strings.TrimSpace(opts.Description)
	if err := validateCreateBackupForDBOptions(opts); err != nil {
		return nil, err
	}
	if client == nil {
		return nil, fmt.Errorf("%w: Kubernetes client is required", ErrBackupValidation)
	}

	cluster, err := client.Resource(kubeBlocksClusterGVR).Namespace(opts.Namespace).Get(ctx, opts.DBName, metav1.GetOptions{})
	if err != nil {
		if apierrors.IsNotFound(err) {
			return nil, fmt.Errorf("%w: DB Service %q was not found in namespace %q", ErrBackupSourceNotFound, opts.DBName, opts.Namespace)
		}
		return nil, fmt.Errorf("failed to get source DB Service %q: %w", opts.DBName, err)
	}
	if !clusterIsRunning(cluster) {
		return nil, fmt.Errorf("%w: DB Service %q must be Running before creating a backup (current phase: %s)", ErrBackupSourceNotRunning, opts.DBName, clusterPhase(cluster))
	}
	engine := engineFromCluster(cluster.Object)
	profile, ok := orchestration.DBEngineProfileFor(engine)
	if !ok {
		return nil, fmt.Errorf("%w: %q", ErrBackupUnsupportedEngine, engine)
	}
	backupMethod := profile.BackupMethod
	componentName := profile.ComponentName

	backupPolicyName := opts.DBName + "-" + componentName + "-backup-policy"

	clusterUID, err := uidFromCluster(cluster)
	if err != nil {
		return nil, err
	}

	backupUnstructured := newManualBackupObject(opts, backupPolicyName, backupMethod, clusterUID)
	created, err := client.Resource(kubeBlocksBackupGVR).Namespace(opts.Namespace).Create(ctx, backupUnstructured, metav1.CreateOptions{})
	if err != nil {
		if apierrors.IsAlreadyExists(err) {
			return nil, fmt.Errorf("%w: Backup Name %q already exists in namespace %q", ErrBackupConflict, opts.BackupName, opts.Namespace)
		}
		return nil, fmt.Errorf("failed to create Backup: %w", err)
	}

	return json.Marshal(created.Object)
}

func validateCreateBackupForDBOptions(opts CreateBackupForDBOptions) error {
	if opts.DBName == "" {
		return fmt.Errorf("%w: name is required", ErrBackupValidation)
	}
	if opts.Namespace == "" {
		return fmt.Errorf("%w: namespace is required", ErrBackupValidation)
	}
	if opts.BackupName == "" {
		return fmt.Errorf("%w: backupName is required", ErrBackupValidation)
	}
	if errs := validation.IsDNS1123Label(opts.BackupName); len(errs) > 0 {
		return fmt.Errorf("%w: backupName must be a lowercase DNS-style Kubernetes name: %s", ErrBackupValidation, strings.Join(errs, "; "))
	}
	if len([]rune(opts.Description)) > maxBackupDescriptionRunes {
		return fmt.Errorf("%w: description must be %d characters or fewer", ErrBackupValidation, maxBackupDescriptionRunes)
	}
	return nil
}

func clusterIsRunning(cluster *unstructured.Unstructured) bool {
	if cluster == nil {
		return false
	}
	phase, _, _ := unstructured.NestedString(cluster.Object, "status", "phase")
	if strings.EqualFold(strings.TrimSpace(phase), "Running") {
		return true
	}
	conditions, _, _ := unstructured.NestedSlice(cluster.Object, "status", "conditions")
	for _, condition := range conditions {
		if readyConditionIsTrue(condition) {
			return true
		}
	}
	return false
}

func clusterPhase(cluster *unstructured.Unstructured) string {
	if cluster == nil {
		return "Unknown"
	}
	phase, _, _ := unstructured.NestedString(cluster.Object, "status", "phase")
	if phase == "" {
		return "Unknown"
	}
	return phase
}

func readyConditionIsTrue(condition interface{}) bool {
	item, ok := condition.(map[string]interface{})
	if !ok {
		return false
	}
	conditionType, _ := item["type"].(string)
	conditionStatus, _ := item["status"].(string)
	return conditionType == "Ready" && conditionStatus == "True"
}

func uidFromCluster(cluster *unstructured.Unstructured) (string, error) {
	clusterMeta, _ := cluster.Object["metadata"].(map[string]interface{})
	if clusterMeta == nil {
		return "", fmt.Errorf("Cluster has no metadata")
	}
	clusterUID, _ := clusterMeta["uid"].(string)
	if clusterUID == "" {
		return "", fmt.Errorf("Cluster has no UID")
	}
	return clusterUID, nil
}

func newManualBackupObject(opts CreateBackupForDBOptions, backupPolicyName, backupMethod, clusterUID string) *unstructured.Unstructured {
	return mapToUnstructured(map[string]interface{}{
		"apiVersion": "dataprotection.kubeblocks.io/v1alpha1",
		"kind":       "Backup",
		"metadata": map[string]interface{}{
			"name":        opts.BackupName,
			"namespace":   opts.Namespace,
			"annotations": manualBackupAnnotations(opts.Description),
			"labels": map[string]interface{}{
				transformdb.KubeBlocksBackupClusterUIDLabel: clusterUID,
			},
		},
		"spec": map[string]interface{}{
			"backupPolicyName": backupPolicyName,
			"backupMethod":     backupMethod,
			"deletionPolicy":   "Delete",
		},
	})
}

func manualBackupAnnotations(description string) map[string]interface{} {
	annotations := map[string]interface{}{
		backupTypeAnnotation: manualBackupType,
	}
	if description != "" {
		annotations[backupDescriptionAnnotation] = description
	}
	return annotations
}

// DeleteBackupForDB deletes one completed or failed DB Service Backup for the source DB Service.
func DeleteBackupForDB(cfg *clientcmdapi.Config, opts DeleteBackupForDBOptions) (DeleteBackupForDBResult, error) {
	if cfg == nil {
		return DeleteBackupForDBResult{}, fmt.Errorf("kubeconfig is required")
	}
	client, ns, err := backupDynamicClientFactory(cfg, opts.Namespace)
	if err != nil {
		return DeleteBackupForDBResult{}, err
	}
	opts.Namespace = ns
	return deleteBackupForDBWithClient(context.Background(), client, opts)
}

func deleteBackupForDBWithClient(ctx context.Context, client dynamic.Interface, opts DeleteBackupForDBOptions) (DeleteBackupForDBResult, error) {
	opts.DBName = strings.TrimSpace(opts.DBName)
	opts.Namespace = strings.TrimSpace(opts.Namespace)
	opts.BackupName = strings.TrimSpace(opts.BackupName)
	if opts.DBName == "" || opts.Namespace == "" || opts.BackupName == "" {
		return DeleteBackupForDBResult{}, fmt.Errorf("DBName, Namespace, and BackupName are required")
	}
	if client == nil {
		return DeleteBackupForDBResult{}, fmt.Errorf("Kubernetes client is required")
	}

	clusterResource := client.Resource(kubeBlocksClusterGVR).Namespace(opts.Namespace)
	backupResource := client.Resource(kubeBlocksBackupGVR).Namespace(opts.Namespace)

	cluster, err := clusterResource.Get(ctx, opts.DBName, metav1.GetOptions{})
	if err != nil {
		if apierrors.IsNotFound(err) {
			return DeleteBackupForDBResult{}, apierrors.NewNotFound(kubeBlocksBackupGVR.GroupResource(), opts.BackupName)
		}
		return DeleteBackupForDBResult{}, err
	}
	clusterUID := string(cluster.GetUID())
	if clusterUID == "" {
		return DeleteBackupForDBResult{}, fmt.Errorf("source DB Service has no UID")
	}

	backup, err := backupResource.Get(ctx, opts.BackupName, metav1.GetOptions{})
	if err != nil {
		return DeleteBackupForDBResult{}, err
	}
	if backup.GetLabels()[transformdb.KubeBlocksBackupClusterUIDLabel] != clusterUID {
		return DeleteBackupForDBResult{}, apierrors.NewNotFound(kubeBlocksBackupGVR.GroupResource(), opts.BackupName)
	}

	deleteStatus := dbBackupDeleteStatus(backup)
	if !isDBBackupDeleteStatusDeletable(deleteStatus) {
		return DeleteBackupForDBResult{}, fmt.Errorf("%w: %s is %s", ErrDBBackupNotDeletable, opts.BackupName, deleteStatus)
	}

	if err := backupResource.Delete(ctx, opts.BackupName, metav1.DeleteOptions{}); err != nil {
		return DeleteBackupForDBResult{}, err
	}

	return DeleteBackupForDBResult{
		BackupName:   opts.BackupName,
		Namespace:    opts.Namespace,
		SourceDBName: opts.DBName,
		Status:       "deleted",
	}, nil
}

func dbBackupDeleteStatus(backup *unstructured.Unstructured) string {
	if backup == nil {
		return "unknown"
	}
	deletionTimestamp := backup.GetDeletionTimestamp()
	if deletionTimestamp != nil && !deletionTimestamp.IsZero() {
		return "deleting"
	}
	for _, field := range []string{"phase", "status", "state"} {
		phase, _, _ := unstructured.NestedString(backup.Object, "status", field)
		if strings.TrimSpace(phase) != "" {
			return strings.ToLower(strings.TrimSpace(phase))
		}
	}
	return ""
}

func isDBBackupDeleteStatusDeletable(status string) bool {
	switch status {
	case "available", "completed", "complete", "succeeded", "success", "failed", "error":
		return true
	default:
		return false
	}
}

func engineFromCluster(cluster map[string]interface{}) string {
	metadata, _ := cluster["metadata"].(map[string]interface{})
	labels, _ := metadata["labels"].(map[string]interface{})
	for _, key := range []string{
		"brain.io/db-engine",
		"clusterdefinition.kubeblocks.io/name",
	} {
		if value, ok := labels[key].(string); ok && value != "" {
			return value
		}
	}
	spec, _ := cluster["spec"].(map[string]interface{})
	if spec == nil {
		return ""
	}
	if e, ok := spec["clusterDefinitionRef"].(string); ok && e != "" {
		return e
	}
	if e, ok := spec["engine"].(string); ok && e != "" {
		return e
	}
	return ""
}

func mapToUnstructured(obj map[string]interface{}) *unstructured.Unstructured {
	return &unstructured.Unstructured{Object: obj}
}

func restConfigAndNamespaceForDBBackup(cfg *clientcmdapi.Config, ns string) (*rest.Config, string, error) {
	resolved, err := middleware.ResolveContext(cfg, middleware.ResolveOptions{
		Namespace:        ns,
		AllNamespaces:    false,
		DefaultNamespace: corev1.NamespaceDefault,
	})
	if err != nil {
		return nil, "", err
	}
	if resolved.Namespace == "" {
		resolved.Namespace = corev1.NamespaceDefault
	}
	return resolved.RestConfig, resolved.Namespace, nil
}
