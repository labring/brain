package main

import (
	"bytes"
	"log"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestRequestLoggerLogsMethodTargetStatusAndDuration(t *testing.T) {
	var output bytes.Buffer
	previousOutput := log.Writer()
	log.SetOutput(&output)
	t.Cleanup(func() {
		log.SetOutput(previousOutput)
	})

	handler := requestLogger(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "bad request", http.StatusBadRequest)
	}))
	request := httptest.NewRequest(http.MethodGet, "/api/k8s/v1alpha1/get?kind=pods", nil)
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	got := output.String()
	for _, want := range []string{
		"GET /api/k8s/v1alpha1/get?kind=pods -> 400",
	} {
		if !strings.Contains(got, want) {
			t.Fatalf("request log %q does not contain %q", got, want)
		}
	}
	parts := strings.Fields(got)
	if len(parts) < 5 {
		t.Fatalf("request log %q does not include duration", got)
	}
}

func TestLoadLocalEnvUsesUIEnvForSharedDatabaseAndAPIEnvForServiceDeps(t *testing.T) {
	dir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dir, "apps", "ui"), 0o755); err != nil {
		t.Fatalf("create ui env dir: %v", err)
	}
	if err := os.MkdirAll(filepath.Join(dir, "apps", "api"), 0o755); err != nil {
		t.Fatalf("create api env dir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "apps", "ui", ".env"), []byte("DATABASE_URL=postgres://ui\nWHODB_URL=http://ui-whodb\nDB_PUBLIC_HOST=192.168.10.189.nip.io\n"), 0o644); err != nil {
		t.Fatalf("write ui env: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "apps", "api", ".env"), []byte("WHODB_URL=http://api-whodb\n"), 0o644); err != nil {
		t.Fatalf("write api env: %v", err)
	}
	previousCwd, err := os.Getwd()
	if err != nil {
		t.Fatalf("get cwd: %v", err)
	}
	t.Cleanup(func() {
		_ = os.Chdir(previousCwd)
		os.Unsetenv("DATABASE_URL")
		os.Unsetenv("DB_PUBLIC_HOST")
		os.Unsetenv("WHODB_URL")
	})
	os.Unsetenv("DATABASE_URL")
	os.Unsetenv("DB_PUBLIC_HOST")
	os.Unsetenv("WHODB_URL")
	if err := os.Chdir(dir); err != nil {
		t.Fatalf("chdir temp repo: %v", err)
	}

	loadLocalEnv()

	if got := os.Getenv("DATABASE_URL"); got != "postgres://ui" {
		t.Fatalf("DATABASE_URL = %q, want UI env value", got)
	}
	if got := os.Getenv("DB_PUBLIC_HOST"); got != "192.168.10.189.nip.io" {
		t.Fatalf("DB_PUBLIC_HOST = %q, want UI env value", got)
	}
	if got := os.Getenv("WHODB_URL"); got != "http://api-whodb" {
		t.Fatalf("WHODB_URL = %q, want API env value", got)
	}
}

func TestLoadLocalEnvWorksFromAPIDirectory(t *testing.T) {
	dir := t.TempDir()
	apiDir := filepath.Join(dir, "apps", "api")
	if err := os.MkdirAll(filepath.Join(dir, "apps", "ui"), 0o755); err != nil {
		t.Fatalf("create ui env dir: %v", err)
	}
	if err := os.MkdirAll(apiDir, 0o755); err != nil {
		t.Fatalf("create api env dir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "apps", "ui", ".env"), []byte("DATABASE_URL=postgres://ui\nDB_PUBLIC_HOST=192.168.10.189.nip.io\n"), 0o644); err != nil {
		t.Fatalf("write ui env: %v", err)
	}
	if err := os.WriteFile(filepath.Join(apiDir, ".env"), []byte("WHODB_URL=http://api-whodb\n"), 0o644); err != nil {
		t.Fatalf("write api env: %v", err)
	}
	previousCwd, err := os.Getwd()
	if err != nil {
		t.Fatalf("get cwd: %v", err)
	}
	t.Cleanup(func() {
		_ = os.Chdir(previousCwd)
		os.Unsetenv("DATABASE_URL")
		os.Unsetenv("DB_PUBLIC_HOST")
		os.Unsetenv("WHODB_URL")
	})
	os.Unsetenv("DATABASE_URL")
	os.Unsetenv("DB_PUBLIC_HOST")
	os.Unsetenv("WHODB_URL")
	if err := os.Chdir(apiDir); err != nil {
		t.Fatalf("chdir api dir: %v", err)
	}

	loadLocalEnv()

	if got := os.Getenv("DATABASE_URL"); got != "postgres://ui" {
		t.Fatalf("DATABASE_URL = %q, want UI env value", got)
	}
	if got := os.Getenv("DB_PUBLIC_HOST"); got != "192.168.10.189.nip.io" {
		t.Fatalf("DB_PUBLIC_HOST = %q, want UI env value", got)
	}
	if got := os.Getenv("WHODB_URL"); got != "http://api-whodb" {
		t.Fatalf("WHODB_URL = %q, want API env value", got)
	}
}
