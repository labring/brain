package db

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
)

func TestAccessHealthChecksReadyOwnedDBThroughWhoDBWithoutExposingSecrets(t *testing.T) {
	store := &fakeAccessHealthStore{
		db: readyAccessHealthDB("pg-main", "ns-a", "postgresql", "project-1"),
		secret: &corev1.Secret{
			ObjectMeta: metav1.ObjectMeta{Name: "pg-main-conn-credential", Namespace: "ns-a"},
			Data: map[string][]byte{
				"host":     []byte("pg-main-postgresql"),
				"port":     []byte("5432"),
				"username": []byte("alice"),
				"password": []byte("s3cr3t"),
			},
		},
	}
	whodb := &recordingWhoDBHealthClient{
		health: &WhoDBHealth{Server: "healthy", Database: "healthy"},
	}
	svc := AccessHealthService{Store: store, WhoDB: whodb}

	result, err := svc.Check(context.Background(), AccessHealthRequest{
		Name:      "pg-main",
		Namespace: "ns-a",
		ProjectID: "project-1",
	})
	if err != nil {
		t.Fatalf("expected health check to succeed: %v", err)
	}

	if result.Status != "healthy" || result.Name != "pg-main" || result.Namespace != "ns-a" || result.Engine != "postgresql" {
		t.Fatalf("unexpected result: %+v", result)
	}
	if result.WhoDB.Server != "healthy" || result.WhoDB.Database != "healthy" {
		t.Fatalf("unexpected WhoDB health result: %+v", result.WhoDB)
	}

	if whodb.credentials.SourceType != "Postgres" {
		t.Fatalf("expected Postgres WhoDB source type, got %q", whodb.credentials.SourceType)
	}
	values := whodb.credentials.Values
	if values["Hostname"] != "pg-main-postgresql.ns-a.svc" {
		t.Fatalf("expected private service hostname, got %q", values["Hostname"])
	}
	if values["Port"] != "5432" || values["Username"] != "alice" || values["Password"] != "s3cr3t" || values["Database"] != "postgres" {
		t.Fatalf("unexpected WhoDB credential values: %+v", values)
	}

	body, err := json.Marshal(result)
	if err != nil {
		t.Fatalf("failed to marshal result: %v", err)
	}
	for _, forbidden := range []string{"s3cr3t", "alice", "pg-main-postgresql"} {
		if strings.Contains(string(body), forbidden) {
			t.Fatalf("health response exposed credential material %q: %s", forbidden, string(body))
		}
	}
}

func TestAccessHealthCanonicalizesKubeBlocksClusterDefinitionEngines(t *testing.T) {
	store := &fakeAccessHealthStore{
		db: readyAccessHealthDB("mysql-main", "ns-a", "apecloud-mysql", "project-1"),
		secret: &corev1.Secret{
			ObjectMeta: metav1.ObjectMeta{Name: "mysql-main-conn-credential", Namespace: "ns-a"},
			Data: map[string][]byte{
				"host":     []byte("mysql-main-mysql"),
				"port":     []byte("3306"),
				"username": []byte("root"),
				"password": []byte("s3cr3t"),
			},
		},
	}
	whodb := &recordingWhoDBHealthClient{
		health: &WhoDBHealth{Server: "healthy", Database: "healthy"},
	}
	svc := AccessHealthService{Store: store, WhoDB: whodb}

	result, err := svc.Check(context.Background(), AccessHealthRequest{
		Name:      "mysql-main",
		Namespace: "ns-a",
		ProjectID: "project-1",
	})
	if err != nil {
		t.Fatalf("expected health check to succeed: %v", err)
	}

	if result.Engine != "mysql" {
		t.Fatalf("engine = %q, want mysql", result.Engine)
	}
	if whodb.credentials.SourceType != "MySQL" {
		t.Fatalf("source type = %q, want MySQL", whodb.credentials.SourceType)
	}
	if got := whodb.credentials.Values["Database"]; got != "mysql" {
		t.Fatalf("database = %q, want mysql", got)
	}
}

func TestAccessHealthRejectsIncompleteConnectionSecret(t *testing.T) {
	store := &fakeAccessHealthStore{
		db: readyAccessHealthDB("pg-main", "ns-a", "postgresql", "project-1"),
		secret: &corev1.Secret{
			ObjectMeta: metav1.ObjectMeta{Name: "pg-main-conn-credential", Namespace: "ns-a"},
			Data: map[string][]byte{
				"host":     []byte("pg-main-postgresql"),
				"port":     []byte("5432"),
				"username": []byte("alice"),
			},
		},
	}
	whodb := &recordingWhoDBHealthClient{
		health: &WhoDBHealth{Server: "healthy", Database: "healthy"},
	}
	svc := AccessHealthService{Store: store, WhoDB: whodb}

	_, err := svc.Check(context.Background(), AccessHealthRequest{
		Name:      "pg-main",
		Namespace: "ns-a",
		ProjectID: "project-1",
	})
	if err == nil || !errors.Is(err, ErrAccessHealthSecretMissing) {
		t.Fatalf("expected missing secret state, got %v", err)
	}
	if whodb.credentials.SourceType != "" {
		t.Fatalf("expected WhoDB not to be called with incomplete credentials, got %+v", whodb.credentials)
	}
}

func TestAccessHealthRecordsSecretFreeAuditEvent(t *testing.T) {
	store := &fakeAccessHealthStore{
		db: readyAccessHealthDB("pg-main", "ns-a", "postgresql", "project-1"),
		secret: &corev1.Secret{
			ObjectMeta: metav1.ObjectMeta{Name: "pg-main-conn-credential", Namespace: "ns-a"},
			Data: map[string][]byte{
				"host":     []byte("pg-main-postgresql"),
				"port":     []byte("5432"),
				"username": []byte("alice"),
				"password": []byte("s3cr3t"),
			},
		},
	}
	whodb := &recordingWhoDBHealthClient{
		health: &WhoDBHealth{Server: "healthy", Database: "healthy"},
	}
	audit := &recordingAccessHealthAudit{}
	svc := AccessHealthService{Store: store, WhoDB: whodb, Audit: audit}

	if _, err := svc.Check(context.Background(), AccessHealthRequest{
		Name:      "pg-main",
		Namespace: "ns-a",
		ProjectID: "project-1",
	}); err != nil {
		t.Fatalf("expected health check to succeed: %v", err)
	}

	if audit.event.Operation != "db.access.health" || audit.event.ProjectID != "project-1" ||
		audit.event.DBName != "pg-main" || audit.event.Engine != "postgresql" || audit.event.Outcome != "healthy" {
		t.Fatalf("unexpected audit event: %+v", audit.event)
	}
	eventBytes, err := json.Marshal(audit.event)
	if err != nil {
		t.Fatalf("failed to marshal audit event: %v", err)
	}
	for _, forbidden := range []string{"s3cr3t", "alice", "pg-main-postgresql"} {
		if strings.Contains(string(eventBytes), forbidden) {
			t.Fatalf("audit event exposed credential material %q: %s", forbidden, string(eventBytes))
		}
	}
}

func TestAccessHealthTreatsWhoDBDatabaseErrorAsUnavailable(t *testing.T) {
	store := &fakeAccessHealthStore{
		db: readyAccessHealthDB("pg-main", "ns-a", "postgresql", "project-1"),
		secret: &corev1.Secret{
			ObjectMeta: metav1.ObjectMeta{Name: "pg-main-conn-credential", Namespace: "ns-a"},
			Data: map[string][]byte{
				"host":     []byte("pg-main-postgresql"),
				"port":     []byte("5432"),
				"username": []byte("alice"),
				"password": []byte("s3cr3t"),
			},
		},
	}
	whodb := &recordingWhoDBHealthClient{
		health: &WhoDBHealth{Server: "healthy", Database: "error"},
	}
	svc := AccessHealthService{Store: store, WhoDB: whodb}

	_, err := svc.Check(context.Background(), AccessHealthRequest{
		Name:      "pg-main",
		Namespace: "ns-a",
		ProjectID: "project-1",
	})
	if err == nil || !errors.Is(err, ErrAccessHealthWhoDBUnavailable) {
		t.Fatalf("expected WhoDB unavailable error, got %v", err)
	}
}

func TestAccessHealthRejectsInvalidRequestAndOwnershipState(t *testing.T) {
	tests := []struct {
		name    string
		db      *unstructured.Unstructured
		request AccessHealthRequest
		wantErr error
	}{
		{
			name:    "missing project id",
			db:      readyAccessHealthDB("pg-main", "ns-a", "postgresql", "project-1"),
			request: AccessHealthRequest{Name: "pg-main", Namespace: "ns-a"},
			wantErr: ErrAccessHealthProjectID,
		},
		{
			name:    "ownership mismatch",
			db:      readyAccessHealthDB("pg-main", "ns-a", "postgresql", "project-2"),
			request: AccessHealthRequest{Name: "pg-main", Namespace: "ns-a", ProjectID: "project-1"},
			wantErr: ErrAccessHealthProjectForbidden,
		},
		{
			name:    "missing ownership metadata",
			db:      accessHealthDBWithoutProject("pg-main", "ns-a", "postgresql"),
			request: AccessHealthRequest{Name: "pg-main", Namespace: "ns-a", ProjectID: "project-1"},
			wantErr: ErrAccessHealthProjectMissing,
		},
		{
			name:    "unsupported engine",
			db:      readyAccessHealthDB("pg-main", "ns-a", "clickhouse", "project-1"),
			request: AccessHealthRequest{Name: "pg-main", Namespace: "ns-a", ProjectID: "project-1"},
			wantErr: ErrAccessHealthUnsupported,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			store := &fakeAccessHealthStore{
				db: tt.db,
				secret: &corev1.Secret{
					ObjectMeta: metav1.ObjectMeta{Name: "pg-main-conn-credential", Namespace: "ns-a"},
					Data: map[string][]byte{
						"host":     []byte("pg-main-postgresql"),
						"port":     []byte("5432"),
						"username": []byte("alice"),
						"password": []byte("s3cr3t"),
					},
				},
			}
			whodb := &recordingWhoDBHealthClient{health: &WhoDBHealth{Server: "healthy", Database: "healthy"}}
			svc := AccessHealthService{Store: store, WhoDB: whodb, Audit: noopAccessHealthAudit{}}

			_, err := svc.Check(context.Background(), tt.request)
			if err == nil || !errors.Is(err, tt.wantErr) {
				t.Fatalf("expected %v, got %v", tt.wantErr, err)
			}
			if whodb.credentials.SourceType != "" {
				t.Fatalf("expected WhoDB not to be called, got %+v", whodb.credentials)
			}
		})
	}
}

func TestWhoDBHTTPClientRequiresURL(t *testing.T) {
	client := NewWhoDBHTTPClient("", nil, time.Second)
	_, err := client.CheckHealth(context.Background(), WhoDBSourceCredentials{SourceType: "Postgres"})
	if err == nil || !errors.Is(err, ErrAccessHealthWhoDBMissing) {
		t.Fatalf("expected missing WhoDB URL error, got %v", err)
	}
}

type fakeAccessHealthStore struct {
	db     *unstructured.Unstructured
	secret *corev1.Secret
}

func (f *fakeAccessHealthStore) GetDB(_ context.Context, namespace, name string) (*unstructured.Unstructured, error) {
	if f.db == nil || f.db.GetNamespace() != namespace || f.db.GetName() != name {
		return nil, ErrAccessHealthDBNotFound
	}
	return f.db.DeepCopy(), nil
}

func (f *fakeAccessHealthStore) GetSecret(_ context.Context, namespace, name string) (*corev1.Secret, error) {
	if f.secret == nil || f.secret.Namespace != namespace || f.secret.Name != name {
		return nil, ErrAccessHealthSecretMissing
	}
	return f.secret.DeepCopy(), nil
}

type recordingWhoDBHealthClient struct {
	credentials WhoDBSourceCredentials
	health      *WhoDBHealth
	err         error
}

type recordingAccessHealthAudit struct {
	event AccessHealthAuditEvent
}

func (r *recordingAccessHealthAudit) LogAccessHealth(event AccessHealthAuditEvent) {
	r.event = event
}

type noopAccessHealthAudit struct{}

func (noopAccessHealthAudit) LogAccessHealth(AccessHealthAuditEvent) {}

func (r *recordingWhoDBHealthClient) CheckHealth(_ context.Context, credentials WhoDBSourceCredentials) (*WhoDBHealth, error) {
	r.credentials = credentials
	if r.err != nil {
		return nil, r.err
	}
	return r.health, nil
}

func readyAccessHealthDB(name, namespace, engine, projectUID string) *unstructured.Unstructured {
	return &unstructured.Unstructured{Object: map[string]interface{}{
		"apiVersion": "apps.kubeblocks.io/v1alpha1",
		"kind":       "Cluster",
		"metadata": map[string]interface{}{
			"name":      name,
			"namespace": namespace,
			"labels": map[string]interface{}{
				ProjectIDLabel: projectUID,
			},
		},
		"spec": map[string]interface{}{
			"clusterDefinitionRef": engine,
		},
		"status": map[string]interface{}{
			"phase":             "Running",
			"availableReplicas": int64(1),
		},
	}}
}

func accessHealthDBWithoutProject(name, namespace, engine string) *unstructured.Unstructured {
	db := readyAccessHealthDB(name, namespace, engine, "project-1")
	db.SetLabels(map[string]string{})
	return db
}
