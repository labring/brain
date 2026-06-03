package db

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/rest"
	clientcmdapi "k8s.io/client-go/tools/clientcmd/api"

	"sealos/api/middleware"
	transformdb "sealos/api/service/transform/db"
)

// CreateBackupForDBOptions holds options for creating an on-demand backup for a DB.
type CreateBackupForDBOptions struct {
	DBName     string // DB instance name (cluster has same name)
	Namespace  string // Namespace
	BackupName string // Name for the Backup CR (defaults to {dbName}-manual-{timestamp})
}

// CreateBackupForDB creates an on-demand KubeBlocks Backup for the given DB.
// The DB must have a running KubeBlocks Cluster with backup enabled.
// For PostgreSQL uses postgres-basebackup; MySQL xtrabackup; MongoDB mongodb-dump; Redis datafile (match Cluster.spec.backup.method).
func CreateBackupForDB(cfg *clientcmdapi.Config, opts CreateBackupForDBOptions) ([]byte, error) {
	if opts.DBName == "" || opts.Namespace == "" {
		return nil, fmt.Errorf("DBName and Namespace are required")
	}

	restConfig, ns, err := restConfigAndNamespaceForDBBackup(cfg, opts.Namespace)
	if err != nil {
		return nil, err
	}
	opts.Namespace = ns

	client, err := dynamic.NewForConfig(restConfig)
	if err != nil {
		return nil, err
	}

	clusterGVR := schema.GroupVersionResource{Group: "apps.kubeblocks.io", Version: "v1", Resource: "clusters"}
	cluster, err := client.Resource(clusterGVR).Namespace(opts.Namespace).Get(context.Background(), opts.DBName, metav1.GetOptions{})
	if err != nil {
		return nil, fmt.Errorf("KubeBlocks Cluster not found for DB %s: %w", opts.DBName, err)
	}
	engine := engineFromCluster(cluster.Object)
	backupMethod := backupMethodForEngine(engine)
	componentName := componentNameForEngine(engine)

	backupPolicyName := opts.DBName + "-" + componentName + "-backup-policy"

	clusterMeta, _ := cluster.Object["metadata"].(map[string]interface{})
	if clusterMeta == nil {
		return nil, fmt.Errorf("Cluster has no metadata")
	}
	clusterUID, _ := clusterMeta["uid"].(string)
	if clusterUID == "" {
		return nil, fmt.Errorf("Cluster has no UID")
	}

	if opts.BackupName == "" {
		opts.BackupName = opts.DBName + "-manual-" + time.Now().Format("20060102-150405")
	}

	backupObj := map[string]interface{}{
		"apiVersion": "dataprotection.kubeblocks.io/v1alpha1",
		"kind":       "Backup",
		"metadata": map[string]interface{}{
			"name":      opts.BackupName,
			"namespace": opts.Namespace,
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

	backupGVR := schema.GroupVersionResource{Group: "dataprotection.kubeblocks.io", Version: "v1alpha1", Resource: "backups"}
	backupUnstructured := mapToUnstructured(backupObj)
	created, err := client.Resource(backupGVR).Namespace(opts.Namespace).Create(context.Background(), backupUnstructured, metav1.CreateOptions{})
	if err != nil {
		return nil, fmt.Errorf("failed to create Backup: %w", err)
	}

	return json.Marshal(created.Object)
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

// backupMethodForEngine maps DB engine to KubeBlocks backupMethod on the Backup CR / policy.
// Values align with typical Cluster.spec.backup.method for each engine on current KubeBlocks builds.
func backupMethodForEngine(engine string) string {
	switch engine {
	case "postgresql", "pg":
		return "postgres-basebackup"
	case "mysql":
		// Must match Cluster.spec.backup.method / BackupPolicy for apecloud-mysql (often "xtrabackup", not "mysql-xtrabackup").
		return "xtrabackup"
	case "mongodb":
		return "mongodb-dump"
	case "redis":
		// Must match Cluster.spec.backup.method for KubeBlocks redis (often "datafile").
		return "datafile"
	default:
		return "postgres-basebackup"
	}
}

func componentNameForEngine(engine string) string {
	switch engine {
	case "postgresql", "pg":
		return "postgresql"
	case "mysql":
		return "mysql"
	case "mongodb":
		return "mongodb"
	case "redis":
		return "redis"
	default:
		return "postgresql"
	}
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
