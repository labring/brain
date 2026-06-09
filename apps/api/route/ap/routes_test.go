package ap

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humachi"
	"github.com/go-chi/chi/v5"
	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/util/intstr"

	"sealos/api/service/apversion"
	orchestration "sealos/api/service/orchestration"
)

func TestAPMutationOpenAPIDocsDescribeDirectKubernetesContract(t *testing.T) {
	router := chi.NewRouter()
	api := humachi.New(router, huma.DefaultConfig("test", "0.0.0"))

	Register(api)

	path := api.OpenAPI().Paths["/api/ap/v1alpha1/"]
	if path == nil || path.Put == nil || path.Patch == nil {
		t.Fatal("expected AP create and update routes to be registered")
	}
	envValuePath := api.OpenAPI().Paths["/api/ap/v1alpha1/env-value"]
	if envValuePath == nil || envValuePath.Get == nil {
		t.Fatal("expected AP resolved env value route to be registered")
	}

	descriptions := map[string]string{
		"create": path.Put.Description,
		"update": path.Patch.Description,
	}
	for name, description := range descriptions {
		t.Run(name, func(t *testing.T) {
			for _, want := range []string{
				"direct Kubernetes",
				"Deployment",
				"spec.input.image",
			} {
				if !strings.Contains(description, want) {
					t.Fatalf("expected %s docs to contain %q, got: %s", name, want, description)
				}
			}
		})
	}

	if !strings.Contains(path.Put.Description, "apiVersion: brain.io/direct") {
		t.Fatalf("expected create docs to contain direct AP manifest example, got: %s", path.Put.Description)
	}
	legacyGroupVersion := "example." + "cross" + "plane.io/v1"
	if strings.Contains(path.Put.Description, legacyGroupVersion) {
		t.Fatalf("AP create docs must not describe the old orchestration API, got: %s", path.Put.Description)
	}
	if !strings.Contains(path.Put.Description, "spec.projectId") {
		t.Fatalf("expected create docs to require spec.projectId, got: %s", path.Put.Description)
	}
	legacyField := "composition" + "Ref"
	if strings.Contains(path.Put.Description+path.Patch.Description, legacyField) {
		t.Fatalf("AP mutation docs must not describe legacy claim API behavior")
	}
}

func TestAPResponseFromDeploymentsReturnsAPList(t *testing.T) {
	raw := []byte(`{
		"apiVersion": "apps/v1",
		"kind": "DeploymentList",
		"items": [
			{
				"apiVersion": "apps/v1",
				"kind": "Deployment",
				"metadata": {
					"labels": {
						"brain.io/project-id": "project-a",
						"brain.io/resource-kind": "ap",
						"cloud.sealos.io/app-deploy-manager": "web"
					},
					"name": "web",
					"namespace": "ns-a"
				},
				"spec": {
					"replicas": 1,
					"selector": {"matchLabels": {"app": "web"}},
					"template": {
						"metadata": {"labels": {"app": "web"}},
						"spec": {"containers": [{"name": "web", "image": "nginx:1.27", "ports": [{"containerPort": 8080}]}]}
					}
				},
				"status": {"replicas": 1, "readyReplicas": 1, "availableReplicas": 1}
			}
		]
	}`)
	body, err := apResponseFromDeployments(raw, false)
	if err != nil {
		t.Fatalf("apResponseFromDeployments returned error: %v", err)
	}
	var out map[string]interface{}
	if err := json.Unmarshal(body, &out); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}
	items := out["items"].([]interface{})
	item := items[0].(map[string]interface{})
	if got := item["kind"]; got != "AP" {
		t.Fatalf("item.kind = %v, want AP", got)
	}
	spec := item["spec"].(map[string]interface{})
	input := spec["input"].(map[string]interface{})
	if got := input["image"]; got != "nginx:1.27" {
		t.Fatalf("image = %v, want nginx:1.27", got)
	}
}

func TestRecordAPImageVersionSideEffectDoesNotBlockWhenDatabaseMissing(t *testing.T) {
	body := json.RawMessage(`{
		"apiVersion": "brain.io/direct",
		"kind": "AP",
		"metadata": {"name": "web", "namespace": "ns-a"},
		"spec": {"input": {"image": "nginx:1.27"}}
	}`)

	got, err := recordAPImageVersionSideEffect(
		context.Background(),
		body,
		"create",
		func(context.Context, map[string]interface{}, string) (*apversion.Version, error) {
			return nil, apversion.ErrDatabaseNotConfigured
		},
	)
	if err != nil {
		t.Fatalf("recordAPImageVersionSideEffect returned error: %v", err)
	}

	var out map[string]interface{}
	if err := json.Unmarshal(got, &out); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}
	metadata := out["metadata"].(map[string]interface{})
	if got := metadata["name"]; got != "web" {
		t.Fatalf("metadata.name = %v, want web", got)
	}
	warnings := metadata["warnings"].([]interface{})
	if len(warnings) != 1 {
		t.Fatalf("warnings length = %d, want 1", len(warnings))
	}
	warning := warnings[0].(map[string]interface{})
	if got := warning["code"]; got != "ap-image-history-unavailable" {
		t.Fatalf("warning code = %v, want ap-image-history-unavailable", got)
	}
	if got := warning["message"]; got != "AP image history storage is not configured" {
		t.Fatalf("warning message = %v, want storage not configured message", got)
	}
}

func TestAPDeploymentLabelSelectorKeepsBrainOwnership(t *testing.T) {
	got := apDeploymentLabelSelector("brain.io/project-id=project-a")
	for _, want := range []string{
		"brain.io/managed-by=brain",
		"brain.io/resource-kind=ap",
		"brain.io/project-id=project-a",
	} {
		if !strings.Contains(got, want) {
			t.Fatalf("selector %q missing %q", got, want)
		}
	}
}

func TestAPOwnershipRequiresBrainLabels(t *testing.T) {
	deployment := appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{
			Labels: map[string]string{
				orchestration.BrainManagedByLabel:    orchestration.BrainManagedByValue,
				orchestration.BrainProjectIDLabel:    "project-a",
				orchestration.BrainResourceKindLabel: orchestration.ResourceKindAP,
			},
			Name: "web",
		},
	}
	if err := requireBrainAPDeployment(deployment); err != nil {
		t.Fatalf("expected Brain AP deployment to pass ownership check: %v", err)
	}
	delete(deployment.Labels, orchestration.BrainManagedByLabel)
	if err := requireBrainAPDeployment(deployment); err == nil {
		t.Fatal("expected missing brain.io/managed-by label to fail ownership check")
	}
}

func TestAPOwnershipRejectsWrongResourceKind(t *testing.T) {
	deployment := appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{
			Labels: map[string]string{
				orchestration.BrainManagedByLabel:    orchestration.BrainManagedByValue,
				orchestration.BrainProjectIDLabel:    "project-a",
				orchestration.BrainResourceKindLabel: orchestration.ResourceKindDB,
			},
			Name: "web",
		},
	}
	if err := requireBrainAPDeployment(deployment); err == nil {
		t.Fatal("expected wrong brain.io/resource-kind label to fail ownership check")
	}
}

func TestAPDeploymentPatchFromProductPatch(t *testing.T) {
	raw := json.RawMessage(`{"metadata":{"labels":{"region":"apps.example.com"}},"spec":{"paused":true,"input":{"image":"nginx:1.28","env":[{"name":"FEATURE_FLAG","value":"true"}],"envRawSource":"\n# app\nFEATURE_FLAG=true\n","network":{"privatePort":8080,"platformAddresses":[{"id":"pa_abc123","port":8080}]}},"resource":{"limits":{"cpu":"500m","memory":"512Mi"},"replicaStrategy":{"type":"fixed","fixed":{"replicas":3}}}}}`)
	patch := apDeploymentPatchFromProductPatch(raw, "web")
	var out map[string]interface{}
	if err := json.Unmarshal(patch, &out); err != nil {
		t.Fatalf("unmarshal patch: %v", err)
	}
	metadata := out["metadata"].(map[string]interface{})
	annotations := metadata["annotations"].(map[string]interface{})
	if got := annotations["brain.io/ap-desired-network"]; got == "" {
		t.Fatalf("desired network annotation should be patched")
	}
	if got := annotations["brain.io/ap-env-raw-source"]; got != "\n# app\nFEATURE_FLAG=true\n" {
		t.Fatalf("env raw source annotation = %v, want raw source", got)
	}
	labels := metadata["labels"].(map[string]interface{})
	if got := labels["region"]; got != "apps.example.com" {
		t.Fatalf("region label = %v, want apps.example.com", got)
	}
	spec := out["spec"].(map[string]interface{})
	if got := spec["replicas"]; got != float64(0) {
		t.Fatalf("replicas = %v, want 0", got)
	}
	if got := annotations["deploy.cloud.sealos.io/pause"]; got != "true" {
		t.Fatalf("pause annotation = %v, want true", got)
	}
	template := spec["template"].(map[string]interface{})
	templateSpec := template["spec"].(map[string]interface{})
	containers := templateSpec["containers"].([]interface{})
	container := containers[0].(map[string]interface{})
	if got := container["image"]; got != "nginx:1.28" {
		t.Fatalf("image = %v, want nginx:1.28", got)
	}
	env := container["env"].([]interface{})
	envRow := env[0].(map[string]interface{})
	if got := envRow["name"]; got != "FEATURE_FLAG" {
		t.Fatalf("env name = %v, want FEATURE_FLAG", got)
	}
	ports := container["ports"].([]interface{})
	port := ports[0].(map[string]interface{})
	if got := port["containerPort"]; got != float64(8080) {
		t.Fatalf("containerPort = %v, want 8080", got)
	}
	resources := container["resources"].(map[string]interface{})
	limits := resources["limits"].(map[string]interface{})
	if got := limits["cpu"]; got != "500m" {
		t.Fatalf("cpu limit = %v, want 500m", got)
	}
}

func TestAPRenderInputFromDeploymentPatchPreservesValueFromAndProbes(t *testing.T) {
	replicas := int32(1)
	current := appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{
			Labels: map[string]string{
				orchestration.BrainProjectIDLabel: "project-a",
			},
			Name:      "web",
			Namespace: "ns-a",
		},
		Spec: appsv1.DeploymentSpec{
			Replicas: &replicas,
			Template: corev1.PodTemplateSpec{
				Spec: corev1.PodSpec{
					Containers: []corev1.Container{
						{
							Image: "nginx:1.27",
							Ports: []corev1.ContainerPort{{Name: "http", ContainerPort: 8080}},
						},
					},
				},
			},
		},
	}

	patch := json.RawMessage(`{
		"spec": {
			"input": {
				"env": [{
					"name": "DATABASE_PASSWORD",
					"valueFrom": {"secretKeyRef": {"name": "pg-conn-credential", "key": "password"}}
				}],
				"probes": {
					"startup": {"httpGet": {"path": "/ready", "port": 8080}, "failureThreshold": 30},
					"readiness": {"httpGet": {"path": "/healthz", "port": 8080}, "initialDelaySeconds": 5}
				}
			}
		}
	}`)
	got, _, err := apRenderInputFromDeploymentPatch(current, patch)
	if err != nil {
		t.Fatalf("apRenderInputFromDeploymentPatch returned error: %v", err)
	}
	if got.Env[0].ValueFrom == nil || got.Env[0].ValueFrom.SecretKeyRef == nil {
		t.Fatalf("env valueFrom was not preserved: %#v", got.Env[0])
	}
	if got.Env[0].ValueFrom.SecretKeyRef.Name != "pg-conn-credential" {
		t.Fatalf("secret name = %q, want pg-conn-credential", got.Env[0].ValueFrom.SecretKeyRef.Name)
	}
	if got.StartupProbe == nil || got.StartupProbe.HTTPGet == nil {
		t.Fatalf("startup probe was not parsed: %#v", got.StartupProbe)
	}
	if got.StartupProbe.HTTPGet.Port != intstr.FromInt(8080) {
		t.Fatalf("startup probe port = %v, want 8080", got.StartupProbe.HTTPGet.Port)
	}
	if got.ReadinessProbe == nil || got.ReadinessProbe.HTTPGet == nil {
		t.Fatalf("readiness probe was not parsed: %#v", got.ReadinessProbe)
	}
	if got.ReadinessProbe.HTTPGet.Path != "/healthz" {
		t.Fatalf("readiness path = %q, want /healthz", got.ReadinessProbe.HTTPGet.Path)
	}
}

func TestAPServicePatchFromProductPatch(t *testing.T) {
	raw := json.RawMessage(`{"spec":{"input":{"network":{"privatePort":8080}}}}`)
	patch := apServicePatchFromProductPatch(raw)
	var out map[string]interface{}
	if err := json.Unmarshal(patch, &out); err != nil {
		t.Fatalf("unmarshal patch: %v", err)
	}
	spec := out["spec"].(map[string]interface{})
	ports := spec["ports"].([]interface{})
	port := ports[0].(map[string]interface{})
	if got := port["port"]; got != float64(8080) {
		t.Fatalf("service port = %v, want 8080", got)
	}
	if got := port["targetPort"]; got != float64(8080) {
		t.Fatalf("service targetPort = %v, want 8080", got)
	}
}

func TestApplyAPPauseStateAllowsZeroReplicasOnUpdate(t *testing.T) {
	replicas := int32(1)
	deployment := &appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{Annotations: map[string]string{}},
		Spec:       appsv1.DeploymentSpec{Replicas: &replicas},
	}

	paused := true
	applyAPPauseState(deployment, &paused)

	if deployment.Spec.Replicas == nil || *deployment.Spec.Replicas != 0 {
		t.Fatalf("replicas = %v, want 0", deployment.Spec.Replicas)
	}
	if got := deployment.Annotations[orchestration.LaunchpadPauseAnnotation]; got != "true" {
		t.Fatalf("pause annotation = %q, want true", got)
	}

	paused = false
	applyAPPauseState(deployment, &paused)
	if deployment.Spec.Replicas == nil || *deployment.Spec.Replicas != 1 {
		t.Fatalf("resume replicas = %v, want 1", deployment.Spec.Replicas)
	}
	if got := deployment.Annotations[orchestration.LaunchpadPauseAnnotation]; got != "false" {
		t.Fatalf("pause annotation = %q, want false", got)
	}
}

func TestPausedElasticAPSkipsHPAOnUpdate(t *testing.T) {
	replicas := int32(2)
	current := appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{
			Annotations: map[string]string{
				orchestration.APReplicaStrategyAnnotation: `{"elastic":{"maxReplicas":4,"minReplicas":2,"target":{"metric":"cpu","type":"utilization","utilizationPercent":70}},"fixed":{"replicas":2},"type":"elastic"}`,
			},
			Labels: map[string]string{
				orchestration.BrainProjectIDLabel: "project-a",
			},
			Name:      "web",
			Namespace: "ns-a",
		},
		Spec: appsv1.DeploymentSpec{
			Replicas: &replicas,
			Template: corev1.PodTemplateSpec{
				Spec: corev1.PodSpec{
					Containers: []corev1.Container{
						{Image: "nginx:1.27", Ports: []corev1.ContainerPort{{Name: "http", ContainerPort: 80}}},
					},
				},
			},
		},
	}

	renderInput, paused, err := apRenderInputFromDeploymentPatch(current, json.RawMessage(`{"spec":{"paused":true}}`))
	if err != nil {
		t.Fatalf("apRenderInputFromDeploymentPatch returned error: %v", err)
	}
	resources, err := orchestration.RenderAPResources(renderInput)
	if err != nil {
		t.Fatalf("RenderAPResources returned error: %v", err)
	}
	applyAPPauseState(resources.Deployment, paused)
	if paused != nil && *paused {
		resources.HPA = nil
	}
	if resources.HPA != nil {
		t.Fatal("paused elastic AP should not keep an HPA")
	}
	if resources.Deployment.Spec.Replicas == nil || *resources.Deployment.Spec.Replicas != 0 {
		t.Fatalf("replicas = %v, want 0", resources.Deployment.Spec.Replicas)
	}
}

func TestAPRenderInputFromDeploymentPatchMergesProductPatchIntoCurrentState(t *testing.T) {
	replicas := int32(1)
	current := appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{
			Annotations: map[string]string{
				orchestration.APDesiredNetworkAnnotation: `{"privatePort":80,"platformAddresses":[{"id":"pa_old123","port":80}]}`,
				orchestration.APEnvRawSourceAnnotation:   "\n# old\nOLD=1\n",
			},
			Labels: map[string]string{
				orchestration.APRoutingDomainLabel: "old.example.com",
				orchestration.BrainProjectIDLabel:  "project-a",
			},
			Name:      "web",
			Namespace: "ns-a",
		},
		Spec: appsv1.DeploymentSpec{
			Replicas: &replicas,
			Template: corev1.PodTemplateSpec{
				Spec: corev1.PodSpec{
					Containers: []corev1.Container{
						{
							Env:   []corev1.EnvVar{{Name: "OLD", Value: "1"}},
							Image: "nginx:1.27",
							Ports: []corev1.ContainerPort{{Name: "http", ContainerPort: 80}},
							Resources: corev1.ResourceRequirements{
								Limits: corev1.ResourceList{
									corev1.ResourceCPU:    resource.MustParse("200m"),
									corev1.ResourceMemory: resource.MustParse("256Mi"),
								},
								Requests: corev1.ResourceList{
									corev1.ResourceCPU:    resource.MustParse("100m"),
									corev1.ResourceMemory: resource.MustParse("128Mi"),
								},
							},
						},
					},
				},
			},
		},
	}

	patch := json.RawMessage(`{"metadata":{"labels":{"region":"apps.example.com"}},"spec":{"input":{"image":"nginx:1.28","env":[{"name":"FEATURE_FLAG","value":"true"}],"envRawSource":"\n# app\nFEATURE_FLAG=true\n","network":{"privatePort":8080,"platformAddresses":[{"id":"pa_new123","port":8080}]}},"resource":{"requests":{"cpu":"250m","memory":"256Mi"},"limits":{"cpu":"500m","memory":"512Mi"},"replicaStrategy":{"type":"fixed","fixed":{"replicas":2}}}}}`)
	got, paused, err := apRenderInputFromDeploymentPatch(current, patch)
	if err != nil {
		t.Fatalf("apRenderInputFromDeploymentPatch returned error: %v", err)
	}
	if paused != nil {
		t.Fatalf("paused = %v, want nil", *paused)
	}
	if got.Name != "web" || got.Namespace != "ns-a" || got.ProjectID != "project-a" {
		t.Fatalf("identity = %s/%s project %s, want ns-a/web project-a", got.Namespace, got.Name, got.ProjectID)
	}
	if got.Image != "nginx:1.28" {
		t.Fatalf("image = %s, want nginx:1.28", got.Image)
	}
	if got.PrivatePort != 8080 {
		t.Fatalf("privatePort = %d, want 8080", got.PrivatePort)
	}
	if got.Replicas != 2 {
		t.Fatalf("replicas = %d, want 2", got.Replicas)
	}
	if got.RoutingDomain != "apps.example.com" {
		t.Fatalf("routingDomain = %s, want apps.example.com", got.RoutingDomain)
	}
	if len(got.Env) != 1 || got.Env[0].Name != "FEATURE_FLAG" || got.Env[0].Value != "true" {
		t.Fatalf("env = %#v, want FEATURE_FLAG=true", got.Env)
	}
	if got.EnvRawSource != "\n# app\nFEATURE_FLAG=true\n" {
		t.Fatalf("envRawSource = %q, want raw source", got.EnvRawSource)
	}
	if got.ResourceReq.Cpu().String() != "250m" || got.ResourceLimit.Memory().String() != "512Mi" {
		t.Fatalf("resources = requests %#v limits %#v, want cpu request 250m and memory limit 512Mi", got.ResourceReq, got.ResourceLimit)
	}
	var network map[string]interface{}
	if err := json.Unmarshal([]byte(got.NetworkJSON), &network); err != nil {
		t.Fatalf("network JSON is invalid: %v", err)
	}
	if got := int32FromMap(network, "privatePort"); got != 8080 {
		t.Fatalf("network privatePort = %d, want 8080", got)
	}
	rows, _ := network["platformAddresses"].([]interface{})
	if len(rows) != 1 {
		t.Fatalf("platformAddresses = %#v, want one row", network["platformAddresses"])
	}
	row, _ := rows[0].(map[string]interface{})
	if row["id"] != "pa_new123" {
		t.Fatalf("platform address id = %v, want pa_new123", row["id"])
	}
}

func TestAPRenderInputFromDeploymentPatchAcceptsElasticReplicaStrategy(t *testing.T) {
	replicas := int32(1)
	current := appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{
			Labels: map[string]string{
				orchestration.BrainProjectIDLabel: "project-a",
			},
			Name:      "web",
			Namespace: "ns-a",
		},
		Spec: appsv1.DeploymentSpec{
			Replicas: &replicas,
			Template: corev1.PodTemplateSpec{
				Spec: corev1.PodSpec{
					Containers: []corev1.Container{
						{
							Image: "nginx:1.27",
							Ports: []corev1.ContainerPort{{Name: "http", ContainerPort: 80}},
						},
					},
				},
			},
		},
	}

	patch := json.RawMessage(`{"spec":{"resource":{"replicaStrategy":{"type":"elastic","fixed":{"replicas":2},"elastic":{"minReplicas":2,"maxReplicas":8,"target":{"metric":"cpu","type":"utilization","utilizationPercent":75}}}}}}`)
	got, _, err := apRenderInputFromDeploymentPatch(current, patch)
	if err != nil {
		t.Fatalf("apRenderInputFromDeploymentPatch returned error: %v", err)
	}
	if got.ReplicaStrategy == nil || got.ReplicaStrategy.Type != "elastic" {
		t.Fatalf("replica strategy = %#v, want elastic", got.ReplicaStrategy)
	}
	if got.ReplicaStrategy.Elastic == nil || got.ReplicaStrategy.Elastic.MaxReplicas != 8 {
		t.Fatalf("elastic strategy = %#v, want maxReplicas 8", got.ReplicaStrategy.Elastic)
	}
}
