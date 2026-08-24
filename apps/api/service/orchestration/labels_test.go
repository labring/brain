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
