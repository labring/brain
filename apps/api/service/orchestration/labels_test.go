package orchestration

import (
	"strings"
	"testing"
	"unicode/utf8"
)

func TestDisplayNameAnnotationPatchValue(t *testing.T) {
	if got := DisplayNameAnnotationPatchValue(" My Service "); got != "My Service" {
		t.Fatalf("trimmed value = %v, want My Service", got)
	}
	if got := DisplayNameAnnotationPatchValue("   "); got != nil {
		t.Fatalf("blank value = %v, want nil (annotation delete)", got)
	}
	if got := DisplayNameAnnotationPatchValue(nil); got != nil {
		t.Fatalf("null value = %v, want nil (annotation delete)", got)
	}
	long := strings.Repeat("名", MaxDisplayNameLength+10)
	got, ok := DisplayNameAnnotationPatchValue(long).(string)
	if !ok || utf8.RuneCountInString(got) != MaxDisplayNameLength {
		t.Fatalf("over-long value kept %d characters, want %d", utf8.RuneCountInString(got), MaxDisplayNameLength)
	}
	if !strings.HasPrefix(long, got) {
		t.Fatal("truncated value must be a prefix of the submitted name")
	}
}
