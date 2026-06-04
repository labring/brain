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
		"create index if not exists ap_image_versions_lookup_idx",
	} {
		if !strings.Contains(statements, want) {
			t.Fatalf("schema statements missing %q:\n%s", want, statements)
		}
	}
}
