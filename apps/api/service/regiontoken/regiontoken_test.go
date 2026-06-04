package regiontoken

import "testing"

func TestSealosDesktopBaseURLFromEnv(t *testing.T) {
	t.Setenv(desktopURLEnv, "desktop.example.internal/")

	got, err := SealosDesktopBaseURL()
	if err != nil {
		t.Fatalf("SealosDesktopBaseURL() error = %v", err)
	}
	if got != "https://desktop.example.internal" {
		t.Fatalf("SealosDesktopBaseURL() = %q, want https://desktop.example.internal", got)
	}
}

func TestSealosDesktopBaseURLPreservesHTTPSURL(t *testing.T) {
	t.Setenv(desktopURLEnv, "https://desktop.example.internal/base/")

	got, err := SealosDesktopBaseURL()
	if err != nil {
		t.Fatalf("SealosDesktopBaseURL() error = %v", err)
	}
	if got != "https://desktop.example.internal/base" {
		t.Fatalf("SealosDesktopBaseURL() = %q, want https://desktop.example.internal/base", got)
	}
}

func TestSealosDesktopBaseURLRequiresEnv(t *testing.T) {
	t.Setenv(desktopURLEnv, "")

	if _, err := SealosDesktopBaseURL(); err == nil {
		t.Fatal("SealosDesktopBaseURL() error = nil, want error")
	}
}

func TestSealosDesktopBaseURLRejectsQueryOrFragment(t *testing.T) {
	tests := []string{
		"https://desktop.example.internal?cluster=dev",
		"https://desktop.example.internal#dev",
	}
	for _, raw := range tests {
		t.Run(raw, func(t *testing.T) {
			t.Setenv(desktopURLEnv, raw)

			if _, err := SealosDesktopBaseURL(); err == nil {
				t.Fatal("SealosDesktopBaseURL() error = nil, want error")
			}
		})
	}
}
