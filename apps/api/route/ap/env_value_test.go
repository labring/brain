package ap

import (
	"context"
	"testing"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
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

func TestAPWorkloadEnvReadsFirstContainerForBothWorkloadKinds(t *testing.T) {
	deploymentEnv := []corev1.EnvVar{{Name: "AFFINE_CONFIG_PATH", Value: "/root/.affine/config"}}
	statefulSetEnv := []corev1.EnvVar{{Name: "DATABASE_URL", Value: "postgresql://db/affine"}}

	deployment := &appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{Name: "affine", Namespace: "ns-admin"},
		Spec: appsv1.DeploymentSpec{Template: corev1.PodTemplateSpec{
			Spec: corev1.PodSpec{Containers: []corev1.Container{{Name: "affine", Env: deploymentEnv}}},
		}},
	}
	statefulSet := &appsv1.StatefulSet{
		ObjectMeta: metav1.ObjectMeta{Name: "affine", Namespace: "ns-admin"},
		Spec: appsv1.StatefulSetSpec{Template: corev1.PodTemplateSpec{
			Spec: corev1.PodSpec{Containers: []corev1.Container{{Name: "affine", Env: statefulSetEnv}}},
		}},
	}

	if got := apWorkloadEnv(&apWorkload{Deployment: deployment}); len(got) != 1 || got[0].Name != "AFFINE_CONFIG_PATH" {
		t.Fatalf("apWorkloadEnv(deployment) = %v, want the deployment container env", got)
	}
	if got := apWorkloadEnv(&apWorkload{StatefulSet: statefulSet}); len(got) != 1 || got[0].Name != "DATABASE_URL" {
		t.Fatalf("apWorkloadEnv(statefulSet) = %v, want the statefulset container env", got)
	}
	if got := apWorkloadEnv(&apWorkload{}); got != nil {
		t.Fatalf("apWorkloadEnv(empty) = %v, want nil", got)
	}
}
