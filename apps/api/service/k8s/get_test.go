package k8s

import (
	"errors"
	"fmt"
	"testing"
)

func TestIsUnknownResourceErrorMatchesWrappedResource(t *testing.T) {
	err := fmt.Errorf("discovery failed: %w", UnknownResourceError{Resource: "widgets"})

	if !IsUnknownResourceError(err, "widgets") {
		t.Fatal("expected wrapped unknown widgets resource error to match")
	}
	if !IsUnknownResourceError(err, "") {
		t.Fatal("expected empty resource filter to match any unknown resource error")
	}
	if IsUnknownResourceError(err, "aps") {
		t.Fatal("did not expect widgets error to match aps")
	}
}

func TestIsUnknownResourceErrorIgnoresPlainText(t *testing.T) {
	err := errors.New(`unknown resource "widgets"`)

	if IsUnknownResourceError(err, "widgets") {
		t.Fatal("plain text errors should not be treated as structured unknown resource errors")
	}
}
