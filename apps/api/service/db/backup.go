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
	"k8s.io/apimachinery/pkg/runtime/schema"
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

var kubeBlocksBackupGVR = schema.GroupVersionResource{
	Group:    "dataprotection.kubeblocks.io",
	Version:  "v1alpha1",
	Resource: "backups",
}

var (
	ErrBackupConflict          = errors.New("backup name already exists")
	ErrBackupSourceNotFound    = errors.New("source DB Service not found")
	ErrBackupSourceNotRunning  = errors.New("source DB Service is not Running")
	ErrBackupUnsupportedEngine = errors.New("unsupported DB engine for backup")
	ErrBackupValidation        = errors.New("invalid backup request")
)

// CreateBackupForDBOptions holds options for creating an on-demand backup for a DB.
type CreateBackupForDBOptions struct {
	DBName      string // DB instance name (cluster has same name)
	Namespace   string // Namespace
	BackupName  string // Name for the Backup CR
	Description string // Optional user description stored in metadata annotations
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
		phase, _, _ := unstructured.NestedString(cluster.Object, "status", "phase")
		if phase == "" {
			phase = "Unknown"
		}
		return nil, fmt.Errorf("%w: DB Service %q must be Running before creating a backup (current phase: %s)", ErrBackupSourceNotRunning, opts.DBName, phase)
	}
	engine := engineFromCluster(cluster.Object)
	profile, ok := orchestration.DBEngineProfileFor(engine)
	if !ok {
		return nil, fmt.Errorf("%w: %q", ErrBackupUnsupportedEngine, engine)
	}
	backupMethod := profile.BackupMethod
	componentName := profile.ComponentName

	backupPolicyName := opts.DBName + "-" + componentName + "-backup-policy"

	clusterMeta, _ := cluster.Object["metadata"].(map[string]interface{})
	if clusterMeta == nil {
		return nil, fmt.Errorf("Cluster has no metadata")
	}
	clusterUID, _ := clusterMeta["uid"].(string)
	if clusterUID == "" {
		return nil, fmt.Errorf("Cluster has no UID")
	}

	annotations := map[string]interface{}{
		backupTypeAnnotation: manualBackupType,
	}
	if opts.Description != "" {
		annotations[backupDescriptionAnnotation] = opts.Description
	}

	backupObj := map[string]interface{}{
		"apiVersion": "dataprotection.kubeblocks.io/v1alpha1",
		"kind":       "Backup",
		"metadata": map[string]interface{}{
			"name":      opts.BackupName,
			"namespace": opts.Namespace,
			"annotations": annotations,
			"labels": map[string]interface{}{
				transformdb.KubeBlocksBackupClusterUIDLabel: clusterUID,
			},
		},
		"spec": map[string]interface{}{
			"backupPolicyName": backupPolicyName,
			"backupMethod":     backupMethod,
			"deletionPolicy":   "Delete",
		},
	}

	backupUnstructured := mapToUnstructured(backupObj)
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
		item, ok := condition.(map[string]interface{})
		if !ok {
			continue
		}
		conditionType, _ := item["type"].(string)
		conditionStatus, _ := item["status"].(string)
		if conditionType == "Ready" && conditionStatus == "True" {
			return true
		}
	}
	return false
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
