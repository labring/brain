package db

import (
	"encoding/json"
	"testing"
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
