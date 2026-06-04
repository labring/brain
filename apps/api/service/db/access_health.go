package db

import (
	"context"
	"errors"
	"fmt"
	"log"
	"strings"
	"time"

	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"

	"sealos/api/service/orchestration"
)

const ProjectIDLabel = orchestration.BrainProjectIDLabel

var (
	ErrAccessHealthDBNotFound       = errors.New("db not found")
	ErrAccessHealthProjectID        = errors.New("projectId is required")
	ErrAccessHealthProjectMissing   = errors.New("db missing project ownership metadata")
	ErrAccessHealthProjectForbidden = errors.New("db project ownership mismatch")
	ErrAccessHealthDBNotReady       = errors.New("db is not ready")
	ErrAccessHealthUnsupported      = errors.New("unsupported db engine")
	ErrAccessHealthSecretMissing    = errors.New("db connection secret is missing")
	ErrAccessHealthWhoDBMissing     = errors.New("WHODB_URL is not configured")
	ErrAccessHealthWhoDBUnavailable = errors.New("whodb is unavailable")
	ErrAccessHealthWhoDBTimeout     = errors.New("whodb request timed out")
)

type AccessHealthRequest struct {
	Name      string
	Namespace string
	ProjectID string
}

type AccessHealthResult struct {
	Status    string      `json:"status"`
	Name      string      `json:"name"`
	Namespace string      `json:"namespace"`
	Engine    string      `json:"engine"`
	WhoDB     WhoDBHealth `json:"whodb"`
}

type WhoDBHealth struct {
	Server   string `json:"server"`
	Database string `json:"database"`
}

type WhoDBSourceCredentials struct {
	SourceType string            `json:"SourceType"`
	Values     map[string]string `json:"Values,omitempty"`
}

type AccessHealthAuditEvent struct {
	Operation    string           `json:"operation"`
	ProjectID    string           `json:"projectId"`
	DBName       string           `json:"db"`
	Namespace    string           `json:"namespace"`
	Engine       string           `json:"engine"`
	Ref          *AccessObjectRef `json:"ref,omitempty"`
	PageSize     int              `json:"pageSize,omitempty"`
	PageOffset   int              `json:"pageOffset,omitempty"`
	Sort         []AccessRowsSort `json:"sort,omitempty"`
	ExportFormat string           `json:"exportFormat,omitempty"`
	RowLimit     int              `json:"rowLimit,omitempty"`
	RowsExported int              `json:"rowsExported,omitempty"`
	Truncated    bool             `json:"truncated,omitempty"`
	Duration     time.Duration    `json:"duration"`
	Outcome      string           `json:"outcome"`
}

type AccessHealthAuditLogger interface {
	LogAccessHealth(event AccessHealthAuditEvent)
}

type AccessHealthStore interface {
	GetDB(ctx context.Context, namespace, name string) (*unstructured.Unstructured, error)
	GetSecret(ctx context.Context, namespace, name string) (*corev1.Secret, error)
}

type WhoDBHealthClient interface {
	CheckHealth(ctx context.Context, credentials WhoDBSourceCredentials) (*WhoDBHealth, error)
}

type AccessHealthService struct {
	Store AccessHealthStore
	WhoDB WhoDBHealthClient
	Audit AccessHealthAuditLogger
}

func (s AccessHealthService) Check(ctx context.Context, req AccessHealthRequest) (result *AccessHealthResult, err error) {
	req.Name = strings.TrimSpace(req.Name)
	req.Namespace = strings.TrimSpace(req.Namespace)
	req.ProjectID = strings.TrimSpace(req.ProjectID)
	start := time.Now()
	audit := AccessHealthAuditEvent{
		Operation: "db.access.health",
		ProjectID: req.ProjectID,
		DBName:    req.Name,
		Namespace: req.Namespace,
		Outcome:   "error",
	}
	defer func() {
		if result != nil {
			audit.Engine = result.Engine
			audit.Outcome = result.Status
		}
		audit.Duration = time.Since(start)
		s.auditLogger().LogAccessHealth(audit)
	}()

	if req.ProjectID == "" {
		return nil, ErrAccessHealthProjectID
	}

	engine, credentials, err := guardDBAccess(ctx, s.Store, guardedAccessRequest{
		Name:      req.Name,
		Namespace: req.Namespace,
		ProjectID: req.ProjectID,
	})
	if err != nil {
		return nil, err
	}
	audit.Engine = engine

	health, err := s.WhoDB.CheckHealth(ctx, credentials)
	if err != nil {
		return nil, err
	}
	if health == nil {
		health = &WhoDBHealth{}
	}
	if !strings.EqualFold(health.Server, "healthy") || !strings.EqualFold(health.Database, "healthy") {
		return nil, fmt.Errorf("%w: server=%s database=%s", ErrAccessHealthWhoDBUnavailable, health.Server, health.Database)
	}

	return &AccessHealthResult{
		Status:    "healthy",
		Name:      req.Name,
		Namespace: req.Namespace,
		Engine:    engine,
		WhoDB:     *health,
	}, nil
}

func (s AccessHealthService) auditLogger() AccessHealthAuditLogger {
	if s.Audit != nil {
		return s.Audit
	}
	return standardAccessHealthAuditLogger{}
}

type standardAccessHealthAuditLogger struct{}

func (standardAccessHealthAuditLogger) LogAccessHealth(event AccessHealthAuditEvent) {
	log.Printf(
		"db access health: operation=%s project=%s db=%s namespace=%s engine=%s duration=%s outcome=%s",
		event.Operation,
		event.ProjectID,
		event.DBName,
		event.Namespace,
		event.Engine,
		event.Duration,
		event.Outcome,
	)
}

type guardedAccessRequest struct {
	Name      string
	Namespace string
	ProjectID string
}

func guardDBAccess(ctx context.Context, store AccessHealthStore, req guardedAccessRequest) (string, WhoDBSourceCredentials, error) {
	db, err := store.GetDB(ctx, req.Namespace, req.Name)
	if err != nil {
		return "", WhoDBSourceCredentials{}, err
	}
	if err := verifyDBProject(db, req.ProjectID); err != nil {
		return "", WhoDBSourceCredentials{}, err
	}
	if !isDBAccessReady(db) {
		return "", WhoDBSourceCredentials{}, ErrAccessHealthDBNotReady
	}

	engine := engineFromCluster(db.Object)
	profile, ok := orchestration.DBEngineProfileFor(engine)
	if !ok {
		return "", WhoDBSourceCredentials{}, fmt.Errorf("%w: %s", ErrAccessHealthUnsupported, engine)
	}

	secretName := accessHealthSecretName(req.Name, profile.Engine)
	secret, err := store.GetSecret(ctx, req.Namespace, secretName)
	if err != nil {
		return "", WhoDBSourceCredentials{}, err
	}
	credentials, err := buildWhoDBSourceCredentials(profile.SourceType, profile.DefaultDatabase, req.Name, req.Namespace, secret)
	if err != nil {
		return "", WhoDBSourceCredentials{}, err
	}
	return profile.Engine, credentials, nil
}

func verifyDBProject(db *unstructured.Unstructured, projectID string) error {
	if db == nil {
		return ErrAccessHealthDBNotFound
	}
	got := strings.TrimSpace(db.GetLabels()[ProjectIDLabel])
	if got == "" {
		return ErrAccessHealthProjectMissing
	}
	if got != projectID {
		return ErrAccessHealthProjectForbidden
	}
	return nil
}

func isDBAccessReady(db *unstructured.Unstructured) bool {
	phase, _, _ := unstructured.NestedString(db.Object, "status", "phase")
	switch strings.ToLower(strings.TrimSpace(phase)) {
	case "running", "ready", "available":
		return true
	default:
		return false
	}
}

func accessHealthSecretName(name, engine string) string {
	if strings.EqualFold(strings.TrimSpace(engine), "redis") {
		return name + "-redis-account-default"
	}
	return name + "-conn-credential"
}

func buildWhoDBSourceCredentials(sourceType, defaultDatabase, dbName, namespace string, secret *corev1.Secret) (WhoDBSourceCredentials, error) {
	if secret == nil || len(secret.Data) == 0 {
		return WhoDBSourceCredentials{}, ErrAccessHealthSecretMissing
	}

	username := secretString(secret, "username", "user")
	password := secretString(secret, "password")
	host := secretString(secret, "host")
	port := secretString(secret, "port")
	database := secretString(secret, "database", "dbname", "databaseName")
	if database == "" {
		database = defaultDatabase
	}
	if host == "" {
		host = defaultServiceHost(dbName, sourceType)
	}
	if port == "" {
		port = defaultPortForSource(sourceType)
	}
	if !hasRequiredSecretFields(sourceType, username, password, secretString(secret, "host"), secretString(secret, "port")) {
		return WhoDBSourceCredentials{}, ErrAccessHealthSecretMissing
	}

	values := map[string]string{
		"Hostname": qualifyServiceHost(host, namespace),
		"Port":     port,
	}
	if username != "" {
		values["Username"] = username
	}
	if password != "" {
		values["Password"] = password
	}
	if database != "" {
		values["Database"] = database
	}

	return WhoDBSourceCredentials{SourceType: sourceType, Values: values}, nil
}

func hasRequiredSecretFields(sourceType, username, password, rawHost, rawPort string) bool {
	if username == "" || password == "" {
		return false
	}
	switch sourceType {
	case "Postgres", "MySQL":
		return rawHost != "" && rawPort != ""
	default:
		return true
	}
}

func secretString(secret *corev1.Secret, keys ...string) string {
	for _, key := range keys {
		if v := secret.Data[key]; len(v) > 0 {
			return string(v)
		}
	}
	return ""
}

func defaultServiceHost(dbName, sourceType string) string {
	switch sourceType {
	case "Redis":
		return dbName + "-redis-redis"
	case "MongoDB":
		return dbName + "-mongodb"
	default:
		return dbName
	}
}

func defaultPortForSource(sourceType string) string {
	switch sourceType {
	case "Postgres":
		return "5432"
	case "MySQL":
		return "3306"
	case "MongoDB":
		return "27017"
	case "Redis":
		return "6379"
	default:
		return ""
	}
}

func qualifyServiceHost(host, namespace string) string {
	host = strings.TrimSpace(host)
	if host == "" || strings.Contains(host, ".svc") {
		return host
	}
	return host + "." + namespace + ".svc"
}
