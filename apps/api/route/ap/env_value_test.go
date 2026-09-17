package ap

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humachi"
	"github.com/go-chi/chi/v5"
	corev1 "k8s.io/api/core/v1"
)

func TestResolveAPEnvSavedRowValueResolvesRuntimeEnvAndSetsNoCache(t *testing.T) {
	resolver := staticSecretResolver{
		"ns-a/pg-conn/user":     "app",
		"ns-a/pg-conn/password": "secret",
	}
	value, err := resolveAPEnvSavedRowValue(context.Background(), resolveAPEnvSavedRowValueInput{
		Env: []corev1.EnvVar{
			{Name: "DATABASE_URL", Value: "postgres://$(PG_USER):$(PG_PASSWORD)@db:5432/app"},
			{
				Name: "PG_USER",
				ValueFrom: &corev1.EnvVarSource{SecretKeyRef: &corev1.SecretKeySelector{
					Key: "user",
					LocalObjectReference: corev1.LocalObjectReference{
						Name: "pg-conn",
					},
				}},
			},
			{
				Name: "PG_PASSWORD",
				ValueFrom: &corev1.EnvVarSource{SecretKeyRef: &corev1.SecretKeySelector{
					Key: "password",
					LocalObjectReference: corev1.LocalObjectReference{
						Name: "pg-conn",
					},
				}},
			},
		},
		Name:           "DATABASE_URL",
		Namespace:      "ns-a",
		SecretResolver: resolver,
	})
	if err != nil {
		t.Fatalf("resolveAPEnvSavedRowValue returned error: %v", err)
	}

	if value != "postgres://app:secret@db:5432/app" {
		t.Fatalf("value = %q, want fully resolved value", value)
	}

	if got := apEnvResolvedValueNoCacheHeader(); got != "no-cache, no-store, must-revalidate" {
		t.Fatalf("Cache-Control = %q, want no-cache, no-store, must-revalidate", got)
	}
}

type staticSecretResolver map[string]string

func (resolver staticSecretResolver) ResolveSecretKey(_ context.Context, namespace, name, key string) (string, error) {
	return resolver[namespace+"/"+name+"/"+key], nil
}

// Regression lock for the StatefulSet 404: template-deployed APs with PVC
// mounts are StatefulSets, and env-value used to query deployments only. The
// test drives the registered handler against a fake apiserver that serves a
// StatefulSet (and a 404 for the Deployment of the same name), so a revert to
// a deployments-only lookup fails with 404 instead of the resolved value.
func TestEnvValueHandlerRevealsStatefulSetBackedAP(t *testing.T) {
	// The kubeconfig transport (ADR-0052) accepts off-cluster servers in development only.
	t.Setenv("NODE_ENV", "development")
	t.Setenv("KUBERNETES_SERVICE_HOST", "")
	t.Setenv("KUBERNETES_SERVICE_PORT", "")
	const statefulSetJSON = `{
		"apiVersion": "apps/v1",
		"kind": "StatefulSet",
		"metadata": {
			"labels": {
				"app": "affine",
				"cloud.sealos.io/app-deploy-manager": "affine",
				"brain.io/managed-by": "brain",
				"brain.io/project-id": "project-a"
			},
			"name": "affine",
			"namespace": "ns-a"
		},
		"spec": {
			"template": {
				"spec": {
					"containers": [{
						"name": "affine",
						"image": "ghcr.io/toeverything/affine:0.26.7",
						"env": [
							{"name": "PG_HOST", "value": "db.ns-a.svc.cluster.local"},
							{"name": "PG_USERNAME", "valueFrom": {"secretKeyRef": {"name": "pg-conn", "key": "username"}}},
							{"name": "PG_PASSWORD", "valueFrom": {"secretKeyRef": {"name": "pg-conn", "key": "password"}}},
							{"name": "DATABASE_URL", "value": "postgresql://$(PG_USERNAME):$(PG_PASSWORD)@$(PG_HOST):5432/affine"}
						]
					}]
				}
			}
		}
	}`
	const secretJSON = `{
		"apiVersion": "v1",
		"kind": "Secret",
		"metadata": {"name": "pg-conn", "namespace": "ns-a"},
		"type": "Opaque",
		"data": {"username": "YXBw", "password": "c2VjcmV0"}
	}`

	fakeAPIServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/api":
			_, _ = w.Write([]byte(`{"kind":"APIVersions","versions":["v1"]}`))
		case "/apis":
			_, _ = w.Write([]byte(`{"kind":"APIGroupList","apiVersion":"v1","groups":[{"name":"apps","versions":[{"groupVersion":"apps/v1","version":"v1"}],"preferredVersion":{"groupVersion":"apps/v1","version":"v1"}}]}`))
		case "/api/v1":
			_, _ = w.Write([]byte(`{"kind":"APIResourceList","apiVersion":"v1","groupVersion":"v1","resources":[{"name":"secrets","singularName":"secret","namespaced":true,"kind":"Secret","verbs":["get","list"]}]}`))
		case "/apis/apps/v1":
			_, _ = w.Write([]byte(`{"kind":"APIResourceList","apiVersion":"v1","groupVersion":"apps/v1","resources":[{"name":"deployments","singularName":"deployment","namespaced":true,"kind":"Deployment","verbs":["get"]},{"name":"statefulsets","singularName":"statefulset","namespaced":true,"kind":"StatefulSet","verbs":["get"]}]}`))
		case "/apis/apps/v1/namespaces/ns-a/deployments/affine":
			w.WriteHeader(http.StatusNotFound)
			_, _ = w.Write([]byte(`{"kind":"Status","apiVersion":"v1","status":"Failure","message":"deployments.apps \"affine\" not found","reason":"NotFound","code":404}`))
		case "/apis/apps/v1/namespaces/ns-a/statefulsets/affine":
			_, _ = w.Write([]byte(statefulSetJSON))
		case "/api/v1/namespaces/ns-a/secrets/pg-conn":
			_, _ = w.Write([]byte(secretJSON))
		default:
			t.Logf("fake apiserver unhandled request: %s", r.URL.Path)
			w.WriteHeader(http.StatusNotFound)
			_, _ = w.Write([]byte(`{"kind":"Status","apiVersion":"v1","status":"Failure","reason":"NotFound","code":404}`))
		}
	}))
	defer fakeAPIServer.Close()

	kubeconfig := fmt.Sprintf(`apiVersion: v1
kind: Config
clusters:
- name: fake
  cluster:
    server: %s
contexts:
- name: fake
  context:
    cluster: fake
    user: fake
    namespace: ns-a
current-context: fake
users:
- name: fake
  user:
    token: test-token
`, fakeAPIServer.URL)

	router := chi.NewRouter()
	api := humachi.New(router, huma.DefaultConfig("test", "0.0.0"))
	Register(api)

	request := httptest.NewRequest(
		http.MethodGet,
		"/api/ap/v1alpha1/env-value?name=affine&namespace=ns-a&envName=DATABASE_URL",
		nil,
	)
	request.Header.Set("Authorization", "Bearer "+url.QueryEscape(kubeconfig))
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("env-value status = %d, want 200 (body: %s)", recorder.Code, recorder.Body.String())
	}
	want := `postgresql://app:secret@db.ns-a.svc.cluster.local:5432/affine`
	var body struct {
		Value string `json:"value"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
		t.Fatalf("unmarshal response: %v (body: %s)", err, recorder.Body.String())
	}
	if body.Value != want {
		t.Fatalf("value = %q, want %q", body.Value, want)
	}
}
