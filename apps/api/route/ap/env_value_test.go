package ap

import (
	"context"
	"testing"

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
