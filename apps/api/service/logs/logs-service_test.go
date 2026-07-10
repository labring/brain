package logs

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/rest"
)

func TestExecuteLogsQueryReturnsEmptySliceWhenVictoriaLogsHasNoEntries(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.URL.Query().Get("query"); got == "" {
			t.Fatal("query parameter was not forwarded")
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	entries, err := executeLogsQuery(
		context.Background(),
		server.URL,
		"{namespace='ns',container='postgresql'}",
		"1710000000",
		"1710003600",
	)
	if err != nil {
		t.Fatalf("executeLogsQuery returned error: %v", err)
	}
	if entries == nil {
		t.Fatal("executeLogsQuery returned a nil slice")
	}

	payload, err := json.Marshal(map[string][]map[string]interface{}{
		"postgresql": entries,
	})
	if err != nil {
		t.Fatalf("marshal response payload: %v", err)
	}
	if string(payload) != `{"postgresql":[]}` {
		t.Fatalf("empty log group encoded as %s, want empty array", payload)
	}
}

func TestQueryAppLogsResolvesVictoriaLogsEndpoint(t *testing.T) {
	const (
		appName   = "demo"
		namespace = "ns-test"
		podName   = "demo-pod"
	)

	kubeServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/namespaces/ns-test/pods" {
			t.Errorf("Kubernetes request path = %q, want pods list path", r.URL.Path)
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(corev1.PodList{
			TypeMeta: metav1.TypeMeta{APIVersion: "v1", Kind: "PodList"},
			Items: []corev1.Pod{{
				ObjectMeta: metav1.ObjectMeta{
					Name:      podName,
					Namespace: namespace,
					Labels:    map[string]string{"app": appName},
				},
				Status: corev1.PodStatus{
					ContainerStatuses: []corev1.ContainerStatus{{Name: appName}},
				},
			}},
		}); err != nil {
			t.Errorf("encode pod list: %v", err)
		}
	}))
	defer kubeServer.Close()

	t.Setenv("VLSELECT_USERNAME", "")
	t.Setenv("VLSELECT_PASSWORD", "")
	t.Setenv("VMAUTH_SECRET_NAMESPACE", "")
	t.Setenv("VMAUTH_SECRET_NAME", "")

	tests := []struct {
		name       string
		path       string
		wantedPath string
	}{
		{name: "bare URL", wantedPath: "/select/logsql/query"},
		{name: "complete query endpoint", path: "/select/logsql/query", wantedPath: "/select/logsql/query"},
		{name: "custom proxy endpoint", path: "/proxy/logsql/query", wantedPath: "/proxy/logsql/query"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			vlServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path != tc.wantedPath {
					w.Header().Set("Content-Type", "text/html; charset=utf-8")
					_, _ = w.Write([]byte("<h2>Single-node VictoriaLogs</h2>"))
					return
				}
				if r.URL.Query().Get("query") == "" {
					t.Error("query parameter was not forwarded")
				}
				w.Header().Set("Content-Type", "application/stream+json")
				_, _ = w.Write([]byte(`{"_time":"2026-07-10T08:00:00Z","_msg":"ready","pod":"demo-pod","container":"demo"}` + "\n"))
			}))
			defer vlServer.Close()
			t.Setenv("VLSELECT_URL", vlServer.URL+tc.path)

			groups, err := QueryAppLogs(
				context.Background(),
				&rest.Config{Host: kubeServer.URL},
				namespace,
				appName,
				"",
				QueryOptions{Start: "1783666800", End: "1783670400"},
			)
			if err != nil {
				t.Fatalf("QueryAppLogs returned error: %v", err)
			}
			entries := groups[podName+"/"+appName]
			if len(entries) != 1 {
				t.Fatalf("log entry count = %d, want 1", len(entries))
			}
			if got := entries[0]["_msg"]; got != "ready" {
				t.Fatalf("log message = %v, want ready", got)
			}
		})
	}
}
