package orchestration

import "testing"

func TestDBEngineProfileBackupMethodsMatchKubeBlocksMethodNames(t *testing.T) {
	tests := []struct {
		engine string
		want   string
	}{
		{engine: "postgresql", want: "pg-basebackup"},
		{engine: "mysql", want: "xtrabackup"},
		{engine: "mongodb", want: "dump"},
		{engine: "redis", want: "datafile"},
	}

	for _, tt := range tests {
		t.Run(tt.engine, func(t *testing.T) {
			profile, ok := DBEngineProfileFor(tt.engine)
			if !ok {
				t.Fatalf("DBEngineProfileFor(%q) returned ok=false", tt.engine)
			}
			if profile.BackupMethod != tt.want {
				t.Fatalf("BackupMethod = %q, want %q", profile.BackupMethod, tt.want)
			}
		})
	}
}
