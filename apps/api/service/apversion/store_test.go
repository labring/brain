package apversion

import (
	"strings"
	"testing"
)

func TestVersionSchemaStatementsCreateAPImageVersionStorage(t *testing.T) {
	statements := strings.Join(VersionSchemaStatements(), "\n")
	for _, want := range []string{
		"create schema if not exists sealai_project",
		"create table if not exists sealai_project.ap_image_versions",
		"constraint ap_image_versions_pk primary key",
		"add column if not exists spec_snapshot jsonb",
		"create index if not exists ap_image_versions_lookup_idx",
	} {
		if !strings.Contains(statements, want) {
			t.Fatalf("schema statements missing %q:\n%s", want, statements)
		}
	}
}

func TestVersionHashForSpecDistinguishesSameImageDifferentSpec(t *testing.T) {
	left := VersionHashForSpec("ns-a", "web", "nginx:1.27", "Always", map[string]interface{}{
		"input": map[string]interface{}{
			"image":   "nginx:1.27",
			"command": []interface{}{"/app/server"},
		},
	})
	right := VersionHashForSpec("ns-a", "web", "nginx:1.27", "Always", map[string]interface{}{
		"input": map[string]interface{}{
			"image":   "nginx:1.27",
			"command": []interface{}{"/app/worker"},
		},
	})
	if left == right {
		t.Fatalf("VersionHashForSpec returned same hash %q for different specs", left)
	}
}
