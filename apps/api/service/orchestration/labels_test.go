package orchestration

import (
	"strings"
	"testing"
)

func TestDisplayNameAnnotationPatchValue(t *testing.T) {
	got, err := DisplayNameAnnotationPatchValue(" My Service ")
	if err != nil || got != "My Service" {
		t.Fatalf("trimmed value = %q, %v, want My Service", got, err)
	}
	if _, err := DisplayNameAnnotationPatchValue("   "); err == nil {
		t.Fatal("blank value must be rejected: a display name is never cleared")
	}
	if _, err := DisplayNameAnnotationPatchValue(nil); err == nil {
		t.Fatal("null value must be rejected: a display name is never cleared")
	}
	exact := strings.Repeat("名", MaxDisplayNameLength)
	got, err = DisplayNameAnnotationPatchValue(exact)
	if err != nil || got != exact {
		t.Fatalf("value of exactly %d characters must be accepted, got %v", MaxDisplayNameLength, err)
	}
	if _, err := DisplayNameAnnotationPatchValue(exact + "名"); err == nil {
		t.Fatal("over-long value must be rejected, not truncated")
	}
}

func TestDisplayNameAnnotationCreateValue(t *testing.T) {
	if got := DisplayNameAnnotationCreateValue(" My Service "); got != "My Service" {
		t.Fatalf("trimmed value = %q, want My Service", got)
	}
	if got := DisplayNameAnnotationCreateValue("   "); got != "" {
		t.Fatalf("blank value = %q, want empty (no annotation)", got)
	}
	exact := strings.Repeat("名", MaxDisplayNameLength)
	if got := DisplayNameAnnotationCreateValue(exact); got != exact {
		t.Fatalf("value of exactly %d characters must be kept", MaxDisplayNameLength)
	}
	// A create never fails on the name — an over-long value is dropped and
	// the resource shows its Kubernetes name (ADR 0066).
	if got := DisplayNameAnnotationCreateValue(exact + "名"); got != "" {
		t.Fatalf("over-long value = %q, want dropped", got)
	}
}
