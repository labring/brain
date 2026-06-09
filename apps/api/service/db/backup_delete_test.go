package db

import (
	"context"
	"errors"
	"testing"

	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/types"
	dynamicfake "k8s.io/client-go/dynamic/fake"

	transformdb "sealos/api/service/transform/db"
)

func TestDeleteBackupForDBDeletesOnlySelectedCompletedBackup(t *testing.T) {
	ctx := context.Background()
	cluster := backupDeleteCluster("orders-db", "database-system", "cluster-uid-1")
	selected := backupDeleteBackup("orders-manual", "database-system", "cluster-uid-1", "Completed")
	other := backupDeleteBackup("orders-other", "database-system", "cluster-uid-1", "Completed")
	client := backupDeleteFakeClient(cluster, selected, other)

	result, err := deleteBackupForDBWithClient(ctx, client, DeleteBackupForDBOptions{
		DBName:     "orders-db",
		Namespace:  "database-system",
		BackupName: "orders-manual",
	})
	if err != nil {
		t.Fatalf("deleteBackupForDBWithClient returned error: %v", err)
	}
	if result.Status != "deleted" || result.BackupName != "orders-manual" || result.SourceDBName != "orders-db" {
		t.Fatalf("unexpected delete result: %+v", result)
	}

	if _, err := client.Resource(kubeBlocksBackupGVR).Namespace("database-system").Get(ctx, "orders-manual", metav1.GetOptions{}); !apierrors.IsNotFound(err) {
		t.Fatalf("selected backup should be deleted, got err=%v", err)
	}
	if _, err := client.Resource(kubeBlocksBackupGVR).Namespace("database-system").Get(ctx, "orders-other", metav1.GetOptions{}); err != nil {
		t.Fatalf("other backup should remain: %v", err)
	}
	if _, err := client.Resource(kubeBlocksClusterGVR).Namespace("database-system").Get(ctx, "orders-db", metav1.GetOptions{}); err != nil {
		t.Fatalf("source DB cluster should remain: %v", err)
	}
}

func TestDeleteBackupForDBAllowsCompletedAndFailedBackups(t *testing.T) {
	for _, phase := range []string{"Completed", "Failed"} {
		t.Run(phase, func(t *testing.T) {
			ctx := context.Background()
			client := backupDeleteFakeClient(
				backupDeleteCluster("orders-db", "database-system", "cluster-uid-1"),
				backupDeleteBackup("orders-backup", "database-system", "cluster-uid-1", phase),
			)

			_, err := deleteBackupForDBWithClient(ctx, client, DeleteBackupForDBOptions{
				DBName:     "orders-db",
				Namespace:  "database-system",
				BackupName: "orders-backup",
			})
			if err != nil {
				t.Fatalf("expected %s backup to be deletable, got %v", phase, err)
			}
		})
	}
}

func TestDeleteBackupForDBProtectsActiveAndUnknownBackups(t *testing.T) {
	for _, phase := range []string{"Pending", "Running", "InProgress", "Deleting", "Unknown"} {
		t.Run(phase, func(t *testing.T) {
			ctx := context.Background()
			client := backupDeleteFakeClient(
				backupDeleteCluster("orders-db", "database-system", "cluster-uid-1"),
				backupDeleteBackup("orders-backup", "database-system", "cluster-uid-1", phase),
			)

			_, err := deleteBackupForDBWithClient(ctx, client, DeleteBackupForDBOptions{
				DBName:     "orders-db",
				Namespace:  "database-system",
				BackupName: "orders-backup",
			})
			if !errors.Is(err, ErrDBBackupNotDeletable) {
				t.Fatalf("expected not-deletable error for %s backup, got %v", phase, err)
			}
			if _, err := client.Resource(kubeBlocksBackupGVR).Namespace("database-system").Get(ctx, "orders-backup", metav1.GetOptions{}); err != nil {
				t.Fatalf("protected backup should remain: %v", err)
			}
		})
	}
}

func TestDeleteBackupForDBTreatsMissingOrDifferentSourceBackupAsNotFound(t *testing.T) {
	tests := []struct {
		name    string
		objects []*unstructured.Unstructured
	}{
		{
			name: "missing backup",
			objects: []*unstructured.Unstructured{
				backupDeleteCluster("orders-db", "database-system", "cluster-uid-1"),
			},
		},
		{
			name: "backup belongs to another source DB",
			objects: []*unstructured.Unstructured{
				backupDeleteCluster("orders-db", "database-system", "cluster-uid-1"),
				backupDeleteCluster("restored-db", "database-system", "cluster-uid-2"),
				backupDeleteBackup("orders-backup", "database-system", "cluster-uid-2", "Completed"),
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ctx := context.Background()
			client := backupDeleteFakeClient(tt.objects...)

			_, err := deleteBackupForDBWithClient(ctx, client, DeleteBackupForDBOptions{
				DBName:     "orders-db",
				Namespace:  "database-system",
				BackupName: "orders-backup",
			})
			if !apierrors.IsNotFound(err) {
				t.Fatalf("expected not-found error, got %v", err)
			}
			if tt.name == "backup belongs to another source DB" {
				if _, err := client.Resource(kubeBlocksBackupGVR).Namespace("database-system").Get(ctx, "orders-backup", metav1.GetOptions{}); err != nil {
					t.Fatalf("backup for another source DB should remain: %v", err)
				}
			}
		})
	}
}

func backupDeleteFakeClient(objects ...*unstructured.Unstructured) *dynamicfake.FakeDynamicClient {
	runtimeObjects := make([]runtime.Object, 0, len(objects))
	for _, object := range objects {
		runtimeObjects = append(runtimeObjects, object)
	}
	return dynamicfake.NewSimpleDynamicClientWithCustomListKinds(
		runtime.NewScheme(),
		map[schema.GroupVersionResource]string{
			kubeBlocksClusterGVR: "ClusterList",
			kubeBlocksBackupGVR:  "BackupList",
		},
		runtimeObjects...,
	)
}

func backupDeleteCluster(name string, namespace string, uid string) *unstructured.Unstructured {
	obj := &unstructured.Unstructured{}
	obj.SetAPIVersion("apps.kubeblocks.io/v1alpha1")
	obj.SetKind("Cluster")
	obj.SetName(name)
	obj.SetNamespace(namespace)
	obj.SetUID(types.UID(uid))
	return obj
}

func backupDeleteBackup(name string, namespace string, clusterUID string, phase string) *unstructured.Unstructured {
	obj := &unstructured.Unstructured{}
	obj.SetAPIVersion("dataprotection.kubeblocks.io/v1alpha1")
	obj.SetKind("Backup")
	obj.SetName(name)
	obj.SetNamespace(namespace)
	obj.SetLabels(map[string]string{
		transformdb.KubeBlocksBackupClusterUIDLabel: clusterUID,
	})
	_ = unstructured.SetNestedField(obj.Object, phase, "status", "phase")
	return obj
}
