package ap

import (
	"encoding/json"
	"testing"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/util/strategicpatch"

	orchestration "sealos/api/service/orchestration"
)

func fixedReplicasDeployment(t *testing.T, replicas int32) *appsv1.Deployment {
	t.Helper()
	return &appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{
			Annotations: map[string]string{
				orchestration.APReplicaStrategyAnnotation: `{"fixed":{"replicas":1},"type":"fixed"}`,
			},
			Labels: map[string]string{
				orchestration.BrainManagedByLabel:            orchestration.BrainManagedByValue,
				orchestration.BrainProjectIDLabel:            "project-a",
				orchestration.LaunchpadAppDeployManagerLabel: "web",
			},
			Name:      "web",
			Namespace: "ns-a",
		},
		Spec: appsv1.DeploymentSpec{
			Replicas: &replicas,
			Template: corev1.PodTemplateSpec{
				Spec: corev1.PodSpec{
					Containers: []corev1.Container{{
						Image: "nginx:1.27",
						Name:  "web",
						Ports: []corev1.ContainerPort{{Name: "http", ContainerPort: 80}},
					}},
				},
			},
		},
	}
}

func patchedDeploymentReplicas(t *testing.T, deployment *appsv1.Deployment, patch []byte) int32 {
	t.Helper()
	original, err := json.Marshal(deployment)
	if err != nil {
		t.Fatalf("marshal deployment: %v", err)
	}
	merged, err := strategicpatch.StrategicMergePatch(original, patch, appsv1.Deployment{})
	if err != nil {
		t.Fatalf("strategic merge patch: %v", err)
	}
	var patched appsv1.Deployment
	if err := json.Unmarshal(merged, &patched); err != nil {
		t.Fatalf("unmarshal strategic merge result: %v", err)
	}
	if patched.Spec.Replicas == nil {
		t.Fatalf("patched deployment has nil replicas")
	}
	return *patched.Spec.Replicas
}

// The settings pane replaces the whole spec.resource subtree, so its patch
// carries the previously rendered legacy `replicas` value next to the new
// replicaStrategy. The documented contract (ap-update OpenAPI description)
// says legacy spec.resource.replicas is only a fallback when replicaStrategy
// is absent — the strategy's fixed replicas must win.
func TestAPUpdateMergePatchScalesFixedReplicasDespiteStaleLegacyField(t *testing.T) {
	deployment := fixedReplicasDeployment(t, 1)

	// Exact bytes produced by apps/ui patchOpsForApSettingsDraft +
	// apMergePatchFromJsonPatchOps for "Number of Replicas" 1 -> 3.
	body := json.RawMessage(`{"spec":{"resource":{` +
		`"limits":{"cpu":"500m","memory":"512Mi"},` +
		`"replicaStrategy":{"fixed":{"replicas":3},"type":"fixed"},` +
		`"replicas":1,` +
		`"requests":{"cpu":"50m","memory":"51Mi"}}}}`)

	patch, err := apUpdateMergePatch(apWorkload{Deployment: deployment}, body, nil, testTime())
	if err != nil {
		t.Fatalf("apUpdateMergePatch returned error: %v", err)
	}

	if got := patchedDeploymentReplicas(t, deployment, patch); got != 3 {
		t.Fatalf("patched deployment replicas = %d, want 3 (replicaStrategy.fixed.replicas must take precedence over the stale legacy spec.resource.replicas echoed back by the client)", got)
	}
}

// Legacy-only patches (no replicaStrategy subtree) must keep scaling by
// spec.resource.replicas.
func TestAPUpdateMergePatchScalesLegacyReplicasWhenStrategyAbsent(t *testing.T) {
	deployment := fixedReplicasDeployment(t, 1)

	body := json.RawMessage(`{"spec":{"resource":{"replicas":4}}}`)

	patch, err := apUpdateMergePatch(apWorkload{Deployment: deployment}, body, nil, testTime())
	if err != nil {
		t.Fatalf("apUpdateMergePatch returned error: %v", err)
	}

	if got := patchedDeploymentReplicas(t, deployment, patch); got != 4 {
		t.Fatalf("patched deployment replicas = %d, want 4", got)
	}
}
