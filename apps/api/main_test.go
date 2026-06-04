package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadLocalEnvUsesUIEnvForSharedDatabaseAndAPIEnvForServiceDeps(t *testing.T) {
	dir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dir, "apps", "ui"), 0o755); err != nil {
		t.Fatalf("create ui env dir: %v", err)
	}
	if err := os.MkdirAll(filepath.Join(dir, "apps", "api"), 0o755); err != nil {
		t.Fatalf("create api env dir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "apps", "ui", ".env"), []byte("DATABASE_URL=postgres://ui\nWHODB_URL=http://ui-whodb\n"), 0o644); err != nil {
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
		os.Unsetenv("WHODB_URL")
	})
	os.Unsetenv("DATABASE_URL")
	os.Unsetenv("WHODB_URL")
	if err := os.Chdir(dir); err != nil {
		t.Fatalf("chdir temp repo: %v", err)
	}

	loadLocalEnv()

	if got := os.Getenv("DATABASE_URL"); got != "postgres://ui" {
		t.Fatalf("DATABASE_URL = %q, want UI env value", got)
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
	if err := os.WriteFile(filepath.Join(dir, "apps", "ui", ".env"), []byte("DATABASE_URL=postgres://ui\n"), 0o644); err != nil {
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
		os.Unsetenv("WHODB_URL")
	})
	os.Unsetenv("DATABASE_URL")
	os.Unsetenv("WHODB_URL")
	if err := os.Chdir(apiDir); err != nil {
		t.Fatalf("chdir api dir: %v", err)
	}

	loadLocalEnv()

	if got := os.Getenv("DATABASE_URL"); got != "postgres://ui" {
		t.Fatalf("DATABASE_URL = %q, want UI env value", got)
	}
	if got := os.Getenv("WHODB_URL"); got != "http://api-whodb" {
		t.Fatalf("WHODB_URL = %q, want API env value", got)
	}
}
