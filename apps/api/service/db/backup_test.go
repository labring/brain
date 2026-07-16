package db

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/dynamic/fake"
	clientcmdapi "k8s.io/client-go/tools/clientcmd/api"

	"sealos/api/service/orchestration"
)

func testBackupDynamicClient(objects ...runtime.Object) dynamic.Interface {
	scheme := runtime.NewScheme()
	return fake.NewSimpleDynamicClientWithCustomListKinds(
		scheme,
		map[schema.GroupVersionResource]string{
			kubeBlocksClusterGVR: "ClusterList",
			kubeBlocksBackupGVR:  "BackupList",
		},
		objects...,
	)
}

func testRunningDBCluster(name string) *unstructured.Unstructured {
	return testRunningDBClusterInNamespace(name, "ns-a")
}

func testRunningDBClusterInNamespace(name string, namespace string) *unstructured.Unstructured {
	cluster := &unstructured.Unstructured{Object: map[string]interface{}{
		"apiVersion": "apps.kubeblocks.io/v1alpha1",
		"kind":       "Cluster",
		"metadata": map[string]interface{}{
			"labels": map[string]interface{}{
				"brain.io/db-engine": "postgresql",
			},
			"name":      name,
			"namespace": namespace,
			"uid":       "cluster-uid-1",
		},
		"spec": map[string]interface{}{
			"clusterDefinitionRef": "postgresql",
		},
		"status": map[string]interface{}{
			"phase": "Running",
		},
	}}
	return cluster
}

func TestCreateBackupForDBWithClientCreatesManualBackupMetadata(t *testing.T) {
	client := testBackupDynamicClient(testRunningDBCluster("orders-db"))

	raw, err := createBackupForDBWithClient(context.Background(), client, CreateBackupForDBOptions{
		BackupName:  "orders-before-migration",
		DBName:      "orders-db",
		Description: "Before invoice migration",
		Namespace:   "ns-a",
	})
	if err != nil {
		t.Fatalf("createBackupForDBWithClient returned error: %v", err)
	}

	var backup map[string]interface{}
	if err := json.Unmarshal(raw, &backup); err != nil {
		t.Fatalf("unmarshal backup: %v", err)
	}
	metadata := backup["metadata"].(map[string]interface{})
	if got := metadata["name"]; got != "orders-before-migration" {
		t.Fatalf("metadata.name = %v, want orders-before-migration", got)
	}
	annotations := metadata["annotations"].(map[string]interface{})
	if got := annotations["brain.io/description"]; got != "Before invoice migration" {
		t.Fatalf("description annotation = %v, want user description", got)
	}
	if got := annotations["brain.io/backup-type"]; got != "manual" {
		t.Fatalf("backup type annotation = %v, want manual", got)
	}
	labels := metadata["labels"].(map[string]interface{})
	if got := labels[orchestration.KubeBlocksBackupClusterUIDLabel]; got != "cluster-uid-1" {
		t.Fatalf("cluster UID label = %v, want cluster-uid-1", got)
	}
	spec := backup["spec"].(map[string]interface{})
	if got := spec["backupPolicyName"]; got != "orders-db-postgresql-backup-policy" {
		t.Fatalf("backupPolicyName = %v, want source DB policy", got)
	}
	if got := spec["backupMethod"]; got != "pg-basebackup" {
		t.Fatalf("backupMethod = %v, want pg-basebackup", got)
	}
	if _, ok := spec["description"]; ok {
		t.Fatal("description should be stored in metadata annotations, not spec")
	}
}

func TestCreateBackupForDBWithClientRequiresBackupName(t *testing.T) {
	client := testBackupDynamicClient(testRunningDBCluster("orders-db"))

	_, err := createBackupForDBWithClient(context.Background(), client, CreateBackupForDBOptions{
		DBName:    "orders-db",
		Namespace: "ns-a",
	})
	if err == nil {
		t.Fatal("expected missing backup name to be rejected")
	}
	if !strings.Contains(err.Error(), "backupName is required") {
		t.Fatalf("expected backupName validation error, got %v", err)
	}
}

func TestCreateBackupForDBWithClientRejectsNonRunningDB(t *testing.T) {
	cluster := testRunningDBCluster("orders-db")
	_ = unstructured.SetNestedField(cluster.Object, "Creating", "status", "phase")
	client := testBackupDynamicClient(cluster)

	_, err := createBackupForDBWithClient(context.Background(), client, CreateBackupForDBOptions{
		BackupName: "orders-before-migration",
		DBName:     "orders-db",
		Namespace:  "ns-a",
	})
	if err == nil {
		t.Fatal("expected non-running DB to be rejected")
	}
	if !strings.Contains(err.Error(), "must be Running") {
		t.Fatalf("expected running-state error, got %v", err)
	}
}

func TestCreateBackupForDBWithClientSurfacesDuplicateConflict(t *testing.T) {
	existing := &unstructured.Unstructured{Object: map[string]interface{}{
		"apiVersion": "dataprotection.kubeblocks.io/v1alpha1",
		"kind":       "Backup",
		"metadata": map[string]interface{}{
			"name":      "orders-before-migration",
			"namespace": "ns-a",
		},
	}}
	client := testBackupDynamicClient(testRunningDBCluster("orders-db"), existing)

	_, err := createBackupForDBWithClient(context.Background(), client, CreateBackupForDBOptions{
		BackupName: "orders-before-migration",
		DBName:     "orders-db",
		Namespace:  "ns-a",
	})
	if err == nil {
		t.Fatal("expected duplicate backup name to be rejected")
	}
	if !errors.Is(err, ErrBackupConflict) {
		t.Fatalf("expected duplicate error to be classified as conflict, got %v", err)
	}
}

func TestCreateBackupForDBWithClientValidatesRequest(t *testing.T) {
	client := testBackupDynamicClient(testRunningDBCluster("orders-db"))
	longDescription := strings.Repeat("x", 121)

	tests := []struct {
		name string
		opts CreateBackupForDBOptions
		want string
	}{
		{
			name: "invalid backup name",
			opts: CreateBackupForDBOptions{
				BackupName: "Orders_Backup",
				DBName:     "orders-db",
				Namespace:  "ns-a",
			},
			want: "lowercase DNS-style",
		},
		{
			name: "long description",
			opts: CreateBackupForDBOptions{
				BackupName:  "orders-before-migration",
				DBName:      "orders-db",
				Description: longDescription,
				Namespace:   "ns-a",
			},
			want: "120 characters",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := createBackupForDBWithClient(context.Background(), client, tt.opts)
			if err == nil {
				t.Fatal("expected validation error")
			}
			if !strings.Contains(err.Error(), tt.want) {
				t.Fatalf("expected error to contain %q, got %v", tt.want, err)
			}
		})
	}
}

func TestCreateBackupForDBUsesKubeconfigNamespaceWhenRequestOmitsNamespace(t *testing.T) {
	cfg := &clientcmdapi.Config{
		Clusters: map[string]*clientcmdapi.Cluster{
			"test": {Server: "https://127.0.0.1"},
		},
		Contexts: map[string]*clientcmdapi.Context{
			"test": {Cluster: "test", AuthInfo: "test", Namespace: "team-a"},
		},
		AuthInfos:      map[string]*clientcmdapi.AuthInfo{"test": {}},
		CurrentContext: "test",
		Kind:           "Config",
		APIVersion:     "v1",
		Preferences:    clientcmdapi.Preferences{},
		Extensions:     nil,
	}
	capturedNamespace := ""
	originalFactory := backupDynamicClientFactory
	backupDynamicClientFactory = func(_ *clientcmdapi.Config, namespace string) (dynamic.Interface, string, error) {
		if namespace != "" {
			t.Fatalf("expected request namespace to be empty, got %q", namespace)
		}
		capturedNamespace = "team-a"
		return testBackupDynamicClient(testRunningDBClusterInNamespace("orders-db", "team-a")), "team-a", nil
	}
	defer func() {
		backupDynamicClientFactory = originalFactory
	}()

	_, err := CreateBackupForDB(cfg, CreateBackupForDBOptions{
		BackupName: "orders-before-migration",
		DBName:     "orders-db",
	})
	if err != nil {
		t.Fatalf("CreateBackupForDB returned error: %v", err)
	}
	if capturedNamespace != "team-a" {
		t.Fatalf("resolved namespace = %q, want kubeconfig namespace team-a", capturedNamespace)
	}
}

func TestCreateBackupForDBWithClientRejectsUnsupportedEngine(t *testing.T) {
	cluster := testRunningDBCluster("orders-db")
	metadata := cluster.Object["metadata"].(map[string]interface{})
	metadata["labels"] = map[string]interface{}{"brain.io/db-engine": "clickhouse"}
	client := testBackupDynamicClient(cluster)

	_, err := createBackupForDBWithClient(context.Background(), client, CreateBackupForDBOptions{
		BackupName: "orders-before-migration",
		DBName:     "orders-db",
		Namespace:  "ns-a",
	})
	if err == nil {
		t.Fatal("expected unsupported engine to be rejected")
	}
	if !errors.Is(err, ErrBackupUnsupportedEngine) {
		t.Fatalf("expected unsupported engine classification, got %v", err)
	}
}
