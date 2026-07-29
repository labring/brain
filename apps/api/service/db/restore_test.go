package db

import (
	"context"
	"encoding/base64"
	"testing"

	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	dynamicfake "k8s.io/client-go/dynamic/fake"

	"sealos/api/service/orchestration"
)

const (
	restoreTestNamespace = "database-system"
	restoreTestSource    = "orders-db"
	restoreTestRestored  = "orders-restore"
)

func TestEnsureRestoredConnectionSecretCreatesWhenNameIsFree(t *testing.T) {
	ctx := context.Background()
	source := restoreSecretTestCluster()
	client := restoreSecretFakeClient(restoreTestSourceSecret())

	if err := ensureRestoredConnectionSecret(ctx, client, source, restoreTestRestored); err != nil {
		t.Fatalf("ensureRestoredConnectionSecret returned error: %v", err)
	}

	created := restoreSecretGet(t, client, dbConnectionSecretName(restoreTestRestored))
	labels := created.GetLabels()
	if labels[orchestration.DBProviderInstanceLabel] != restoreTestRestored {
		t.Fatalf("instance label = %q, want %q", labels[orchestration.DBProviderInstanceLabel], restoreTestRestored)
	}
	if labels[orchestration.DBProviderManagedByLabel] != restoredConnectionSecretManagedByValue {
		t.Fatalf("managed-by label = %q, want %q", labels[orchestration.DBProviderManagedByLabel], restoredConnectionSecretManagedByValue)
	}
	if got := restoreSecretData(t, created, "username"); got != "source-user" {
		t.Fatalf("username = %q, want source-user", got)
	}
	if got := restoreSecretData(t, created, "host"); got != restoreTestRestored+"-postgresql" {
		t.Fatalf("host = %q, want %s-postgresql", got, restoreTestRestored)
	}
}

func TestEnsureRestoredConnectionSecretUpdatesOwnedSecretOnRetry(t *testing.T) {
	ctx := context.Background()
	source := restoreSecretTestCluster()
	owned := restoreSecretWithLabels(map[string]string{
		orchestration.DBProviderInstanceLabel:  restoreTestRestored,
		orchestration.DBProviderManagedByLabel: restoredConnectionSecretManagedByValue,
	}, map[string]string{"username": "stale-user", "password": "stale-password"})
	client := restoreSecretFakeClient(restoreTestSourceSecret(), owned)

	if err := ensureRestoredConnectionSecret(ctx, client, source, restoreTestRestored); err != nil {
		t.Fatalf("ensureRestoredConnectionSecret returned error on owned retry: %v", err)
	}

	updated := restoreSecretGet(t, client, dbConnectionSecretName(restoreTestRestored))
	if got := restoreSecretData(t, updated, "username"); got != "source-user" {
		t.Fatalf("username = %q, want source-user", got)
	}
	if got := restoreSecretData(t, updated, "host"); got != restoreTestRestored+"-postgresql" {
		t.Fatalf("host = %q, want %s-postgresql", got, restoreTestRestored)
	}
}

func TestEnsureRestoredConnectionSecretRefusesUnownedSecret(t *testing.T) {
	cases := []struct {
		name   string
		labels map[string]string
	}{
		{
			name:   "no labels at all",
			labels: nil,
		},
		{
			name:   "empty instance label",
			labels: map[string]string{orchestration.DBProviderInstanceLabel: ""},
		},
		{
			name: "instance label belongs to another DB",
			labels: map[string]string{
				orchestration.DBProviderInstanceLabel:  "someone-elses-db",
				orchestration.DBProviderManagedByLabel: restoredConnectionSecretManagedByValue,
			},
		},
		{
			name: "instance matches but managed-by is foreign",
			labels: map[string]string{
				orchestration.DBProviderInstanceLabel:  restoreTestRestored,
				orchestration.DBProviderManagedByLabel: "some-other-controller",
			},
		},
		{
			name:   "instance matches but managed-by is absent",
			labels: map[string]string{orchestration.DBProviderInstanceLabel: restoreTestRestored},
		},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			ctx := context.Background()
			source := restoreSecretTestCluster()
			victim := restoreSecretWithLabels(testCase.labels, map[string]string{
				"username": "victim-user",
				"password": "victim-password",
				"host":     "victim-host",
			})
			client := restoreSecretFakeClient(restoreTestSourceSecret(), victim)

			err := ensureRestoredConnectionSecret(ctx, client, source, restoreTestRestored)
			if err == nil {
				t.Fatal("expected unowned connection secret to be refused")
			}
			if !apierrors.IsAlreadyExists(err) {
				t.Fatalf("error should map to AlreadyExists/409, got %v", err)
			}

			preserved := restoreSecretGet(t, client, dbConnectionSecretName(restoreTestRestored))
			for key, want := range map[string]string{
				"username": "victim-user",
				"password": "victim-password",
				"host":     "victim-host",
			} {
				if got := restoreSecretData(t, preserved, key); got != want {
					t.Fatalf("%s = %q, want %q — the unowned secret was modified", key, got, want)
				}
			}
			if got := preserved.GetLabels()[orchestration.DBProviderManagedByLabel]; got != testCase.labels[orchestration.DBProviderManagedByLabel] {
				t.Fatalf("managed-by label = %q, want %q — labels were rewritten", got, testCase.labels[orchestration.DBProviderManagedByLabel])
			}
		})
	}
}

func restoreSecretFakeClient(objects ...*unstructured.Unstructured) *dynamicfake.FakeDynamicClient {
	runtimeObjects := make([]runtime.Object, 0, len(objects))
	for _, object := range objects {
		runtimeObjects = append(runtimeObjects, object)
	}
	return dynamicfake.NewSimpleDynamicClientWithCustomListKinds(
		runtime.NewScheme(),
		map[schema.GroupVersionResource]string{
			coreSecretGVR: "SecretList",
		},
		runtimeObjects...,
	)
}

func restoreSecretTestCluster() *unstructured.Unstructured {
	cluster := &unstructured.Unstructured{}
	cluster.SetAPIVersion("apps.kubeblocks.io/v1alpha1")
	cluster.SetKind("Cluster")
	cluster.SetName(restoreTestSource)
	cluster.SetNamespace(restoreTestNamespace)
	cluster.SetLabels(map[string]string{orchestration.BrainDBEngineLabel: "postgresql"})
	return cluster
}

func restoreTestSourceSecret() *unstructured.Unstructured {
	return restoreSecretObject(dbConnectionSecretName(restoreTestSource), map[string]string{
		orchestration.DBProviderInstanceLabel:  restoreTestSource,
		orchestration.DBProviderManagedByLabel: restoredConnectionSecretManagedByValue,
	}, map[string]string{
		"username": "source-user",
		"password": "source-password",
		"host":     restoreTestSource + "-postgresql",
	})
}

func restoreSecretWithLabels(labels map[string]string, data map[string]string) *unstructured.Unstructured {
	return restoreSecretObject(dbConnectionSecretName(restoreTestRestored), labels, data)
}

func restoreSecretObject(name string, labels map[string]string, data map[string]string) *unstructured.Unstructured {
	encoded := map[string]interface{}{}
	for key, value := range data {
		encoded[key] = base64.StdEncoding.EncodeToString([]byte(value))
	}
	secret := &unstructured.Unstructured{Object: map[string]interface{}{
		"apiVersion": "v1",
		"kind":       "Secret",
		"metadata": map[string]interface{}{
			"name":      name,
			"namespace": restoreTestNamespace,
		},
		"type": "Opaque",
		"data": encoded,
	}}
	if labels != nil {
		secret.SetLabels(labels)
	}
	return secret
}

func restoreSecretGet(t *testing.T, client *dynamicfake.FakeDynamicClient, name string) *unstructured.Unstructured {
	t.Helper()
	secret, err := client.Resource(coreSecretGVR).Namespace(restoreTestNamespace).
		Get(context.Background(), name, metav1.GetOptions{})
	if err != nil {
		t.Fatalf("failed to get secret %s: %v", name, err)
	}
	return secret
}

func restoreSecretData(t *testing.T, secret *unstructured.Unstructured, key string) string {
	t.Helper()
	data, found, err := unstructured.NestedStringMap(secret.Object, "data")
	if err != nil || !found {
		t.Fatalf("secret %s has no data (found=%v, err=%v)", secret.GetName(), found, err)
	}
	decoded, err := base64.StdEncoding.DecodeString(data[key])
	if err != nil {
		t.Fatalf("failed to decode %s: %v", key, err)
	}
	return string(decoded)
}
