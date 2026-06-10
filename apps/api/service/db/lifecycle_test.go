package db

import (
	"encoding/base64"
	"encoding/json"
	"strings"
	"testing"

	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"

	"sealos/api/service/orchestration"
)

func TestDBPausedPatchSetsOnlyPausedLifecycleFlag(t *testing.T) {
	tests := []struct {
		name   string
		paused bool
		want   string
	}{
		{name: "stop", paused: true, want: `{"spec":{"paused":true}}`},
		{name: "start", paused: false, want: `{"spec":{"paused":false}}`},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := DBPausedPatch(tt.paused)
			if err != nil {
				t.Fatalf("DBPausedPatch returned error: %v", err)
			}
			assertJSONEqual(t, got, []byte(tt.want))
		})
	}
}

func TestDBRestartPatchIncrementsCurrentRestartRequest(t *testing.T) {
	current := []byte(`{
			"apiVersion": "brain.io/direct",
			"kind": "DB",
		"spec": {
			"engine": "postgresql",
			"replicas": 3,
			"restartRequest": 4
		}
	}`)

	got, err := DBRestartPatch(current)
	if err != nil {
		t.Fatalf("DBRestartPatch returned error: %v", err)
	}

	assertJSONEqual(t, got, []byte(`{"spec":{"restartRequest":5}}`))
}

func TestDBRestartPatchTreatsMissingRestartRequestAsZero(t *testing.T) {
	current := []byte(`{"spec":{"engine":"redis"}}`)

	got, err := DBRestartPatch(current)
	if err != nil {
		t.Fatalf("DBRestartPatch returned error: %v", err)
	}

	assertJSONEqual(t, got, []byte(`{"spec":{"restartRequest":1}}`))
}

func TestDBRestartPatchRejectsNegativeRestartRequest(t *testing.T) {
	current := []byte(`{"spec":{"restartRequest":-1}}`)

	_, err := DBRestartPatch(current)
	if err == nil {
		t.Fatal("expected negative restartRequest to be rejected")
	}
}

func TestBuildRestoreDBPlanRequiresCompletedBackup(t *testing.T) {
	source := restoreTestCluster("orders-db")
	backup := unstructured.Unstructured{Object: map[string]interface{}{
		"metadata": map[string]interface{}{
			"name":      "orders-manual-20260609",
			"namespace": "database-system",
			"labels": map[string]interface{}{
				"dataprotection.kubeblocks.io/cluster-uid": "cluster-uid-1",
			},
		},
		"status": map[string]interface{}{
			"phase": "Running",
		},
	}}

	_, err := BuildRestoreDBPlan(RestoreDBPlanInput{
		Backup:       &backup,
		RestoredName: "orders-restore",
		Source:       source,
	})
	if err == nil {
		t.Fatal("expected incomplete backup to be rejected")
	}
	if !strings.Contains(err.Error(), "completed") {
		t.Fatalf("expected completed-only error, got %v", err)
	}
}

func TestBuildRestoreDBPlanCreatesNewDBInSameNamespaceAndProject(t *testing.T) {
	source := restoreTestCluster("orders-db")
	backup := unstructured.Unstructured{Object: map[string]interface{}{
		"metadata": map[string]interface{}{
			"name":      "orders-manual-20260609",
			"namespace": "database-system",
			"labels": map[string]interface{}{
				"dataprotection.kubeblocks.io/cluster-uid": "cluster-uid-1",
			},
		},
		"status": map[string]interface{}{
			"phase": "Completed",
		},
	}}

	plan, err := BuildRestoreDBPlan(RestoreDBPlanInput{
		Backup:       &backup,
		RestoredName: "orders-restore",
		Source:       source,
	})
	if err != nil {
		t.Fatalf("BuildRestoreDBPlan returned error: %v", err)
	}

	if plan.SourceName != "orders-db" {
		t.Fatalf("source name = %q, want orders-db", plan.SourceName)
	}
	if plan.Resources.Cluster.GetName() != "orders-restore" {
		t.Fatalf("restored Cluster name = %q, want orders-restore", plan.Resources.Cluster.GetName())
	}
	if source.GetName() != "orders-db" {
		t.Fatalf("source Cluster was mutated to %q", source.GetName())
	}
	labels := plan.Resources.Cluster.GetLabels()
	if got := labels[orchestration.BrainProjectIDLabel]; got != "project-a" {
		t.Fatalf("project label = %q, want project-a", got)
	}
	if got := plan.Resources.Cluster.GetNamespace(); got != "database-system" {
		t.Fatalf("namespace = %q, want database-system", got)
	}
	spec := plan.Resources.Cluster.Object["spec"].(map[string]interface{})
	restore := plan.Resources.Cluster.GetAnnotations()["kubeblocks.io/restore-from-backup"]
	if restore == "" {
		t.Fatal("missing kubeblocks restore-from-backup annotation")
	}
	if !strings.Contains(restore, `"name":"orders-manual-20260609"`) {
		t.Fatalf("restore annotation = %q, want orders-manual-20260609 backup", restore)
	}
	if !strings.Contains(restore, `"namespace":"database-system"`) {
		t.Fatalf("restore annotation = %q, want database-system namespace", restore)
	}
	component := spec["componentSpecs"].([]interface{})[0].(map[string]interface{})
	if got := component["replicas"]; got != int64(2) {
		t.Fatalf("replicas = %v, want inherited 2", got)
	}
	backupPolicy := spec["backup"].(map[string]interface{})
	if got := backupPolicy["method"]; got != "pg-basebackup" {
		t.Fatalf("backup method = %v, want inherited pg-basebackup", got)
	}
	if got := backupPolicy["enabled"]; got != true {
		t.Fatalf("backup enabled = %v, want inherited true", got)
	}
	resources := component["resources"].(map[string]interface{})
	limits := resources["limits"].(map[string]interface{})
	if got := limits["memory"]; got != "2Gi" {
		t.Fatalf("memory limit = %v, want inherited 2Gi", got)
	}
	templates := component["volumeClaimTemplates"].([]interface{})
	template := templates[0].(map[string]interface{})
	storage, _, _ := unstructured.NestedString(template, "spec", "resources", "requests", "storage")
	if storage != "20Gi" {
		t.Fatalf("storage = %q, want inherited 20Gi", storage)
	}
}

func TestBuildRestoredConnectionSecretKeepsSourceCredentialsAndTargetsRestoredHost(t *testing.T) {
	sourceSecret := &unstructured.Unstructured{Object: map[string]interface{}{
		"apiVersion": "v1",
		"kind":       "Secret",
		"metadata": map[string]interface{}{
			"name":      "orders-db-conn-credential",
			"namespace": "database-system",
			"labels": map[string]interface{}{
				"app.kubernetes.io/instance":      "orders-db",
				"app.kubernetes.io/managed-by":    "kubeblocks",
				"app.kubernetes.io/name":          "postgresql",
				"apps.kubeblocks.io/cluster-type": "postgresql",
			},
		},
		"data": map[string]interface{}{
			"endpoint": base64.StdEncoding.EncodeToString([]byte("orders-db-postgresql:5432")),
			"host":     base64.StdEncoding.EncodeToString([]byte("orders-db-postgresql")),
			"password": base64.StdEncoding.EncodeToString([]byte("source-password")),
			"port":     base64.StdEncoding.EncodeToString([]byte("5432")),
			"username": base64.StdEncoding.EncodeToString([]byte("postgres")),
		},
	}}
	profile, ok := orchestration.DBEngineProfileFor("postgresql")
	if !ok {
		t.Fatal("missing PostgreSQL profile")
	}

	secret, err := buildRestoredConnectionSecret(sourceSecret, "orders-restore", profile)
	if err != nil {
		t.Fatalf("buildRestoredConnectionSecret returned error: %v", err)
	}

	if secret.GetName() != "orders-restore-conn-credential" {
		t.Fatalf("secret name = %q, want orders-restore-conn-credential", secret.GetName())
	}
	if secret.GetNamespace() != "database-system" {
		t.Fatalf("secret namespace = %q, want database-system", secret.GetNamespace())
	}
	labels := secret.GetLabels()
	if got := labels["app.kubernetes.io/instance"]; got != "orders-restore" {
		t.Fatalf("instance label = %q, want orders-restore", got)
	}
	data, _, _ := unstructured.NestedStringMap(secret.Object, "data")
	if decodeTestSecretValue(t, data["username"]) != "postgres" {
		t.Fatalf("username was not inherited from source")
	}
	if decodeTestSecretValue(t, data["password"]) != "source-password" {
		t.Fatalf("password was not inherited from source")
	}
	if got := decodeTestSecretValue(t, data["host"]); got != "orders-restore-postgresql" {
		t.Fatalf("host = %q, want orders-restore-postgresql", got)
	}
	if got := decodeTestSecretValue(t, data["endpoint"]); got != "orders-restore-postgresql:5432" {
		t.Fatalf("endpoint = %q, want orders-restore-postgresql:5432", got)
	}
	if got := decodeTestSecretValue(t, data["port"]); got != "5432" {
		t.Fatalf("port = %q, want 5432", got)
	}
}

func restoreTestCluster(name string) *unstructured.Unstructured {
	cluster := &unstructured.Unstructured{Object: map[string]interface{}{
		"apiVersion": "apps.kubeblocks.io/v1alpha1",
		"kind":       "Cluster",
		"metadata": map[string]interface{}{
			"labels": map[string]interface{}{
				orchestration.BrainManagedByLabel:    orchestration.BrainManagedByValue,
				orchestration.BrainDBEngineLabel:     "postgresql",
				orchestration.BrainProjectIDLabel:    "project-a",
				orchestration.BrainResourceKindLabel: orchestration.ResourceKindDB,
			},
			"name":      name,
			"namespace": "database-system",
			"uid":       "cluster-uid-1",
		},
		"spec": map[string]interface{}{
			"clusterVersionRef": "postgresql-16",
			"backup": map[string]interface{}{
				"enabled": true,
				"method":  "pg-basebackup",
			},
			"componentSpecs": []interface{}{
				map[string]interface{}{
					"name":     "postgresql",
					"replicas": int64(2),
					"resources": map[string]interface{}{
						"limits": map[string]interface{}{
							"cpu":    "1500m",
							"memory": "2Gi",
						},
						"requests": map[string]interface{}{
							"cpu":    "500m",
							"memory": "1Gi",
						},
					},
					"volumeClaimTemplates": []interface{}{
						map[string]interface{}{
							"name": "data",
							"spec": map[string]interface{}{
								"resources": map[string]interface{}{
									"requests": map[string]interface{}{
										"storage": "20Gi",
									},
								},
							},
						},
					},
				},
			},
			"terminationPolicy": "Delete",
		},
	}}
	cluster.SetLabels(map[string]string{
		orchestration.BrainManagedByLabel:    orchestration.BrainManagedByValue,
		orchestration.BrainDBEngineLabel:     "postgresql",
		orchestration.BrainProjectIDLabel:    "project-a",
		orchestration.BrainResourceKindLabel: orchestration.ResourceKindDB,
	})
	return cluster
}

func assertJSONEqual(t *testing.T, got []byte, want []byte) {
	t.Helper()
	var gotValue interface{}
	if err := json.Unmarshal(got, &gotValue); err != nil {
		t.Fatalf("invalid JSON from implementation: %v\n%s", err, string(got))
	}
	var wantValue interface{}
	if err := json.Unmarshal(want, &wantValue); err != nil {
		t.Fatalf("invalid JSON in test: %v\n%s", err, string(want))
	}
	gotCanonical, _ := json.Marshal(gotValue)
	wantCanonical, _ := json.Marshal(wantValue)
	if string(gotCanonical) != string(wantCanonical) {
		t.Fatalf("unexpected JSON\nwant: %s\n got: %s", wantCanonical, gotCanonical)
	}
}

func decodeTestSecretValue(t *testing.T, encoded string) string {
	t.Helper()
	value, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		t.Fatalf("invalid base64 secret value: %v", err)
	}
	return string(value)
}
