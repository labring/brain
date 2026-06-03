package orchestration

import (
	"testing"
	"time"
)

func TestRenderAPResourcesLabelsAndNames(t *testing.T) {
	resources, err := RenderAPResources(APResourcesInput{
		Image:       "nginx:1.27",
		Name:        "web",
		Namespace:   "ns-a",
		PrivatePort: 8080,
		ProjectID:   "project-a",
	})
	if err != nil {
		t.Fatalf("RenderAPResources returned error: %v", err)
	}
	if resources.Deployment.Name != "web" {
		t.Fatalf("deployment name = %q, want web", resources.Deployment.Name)
	}
	if resources.Service.Name != "web-service" {
		t.Fatalf("service name = %q, want web-service", resources.Service.Name)
	}
	labels := resources.Deployment.Labels
	if got := labels[BrainProjectIDLabel]; got != "project-a" {
		t.Fatalf("%s = %q, want project-a", BrainProjectIDLabel, got)
	}
	if got := labels[LaunchpadAppDeployManagerLabel]; got != "web" {
		t.Fatalf("%s = %q, want web", LaunchpadAppDeployManagerLabel, got)
	}
	templateLabels := resources.Deployment.Spec.Template.Labels
	if got := templateLabels[LaunchpadAppLabel]; got != "web" {
		t.Fatalf("pod template app label = %q, want web", got)
	}
	if got := resources.Service.Spec.Selector[LaunchpadAppLabel]; got != "web" {
		t.Fatalf("service selector app label = %q, want web", got)
	}
}

func TestRenderAPPublicIngressLabelsAndBackend(t *testing.T) {
	ingress, err := RenderAPPublicIngress(APPublicIngressInput{
		APName:       "web",
		Host:         "web.example.com",
		Namespace:    "ns-a",
		ProjectID:    "project-a",
		PublicID:     "pa_abc",
		PublicKind:   "platform",
		ResourceName: "web-pa-abc",
		ServicePort:  8080,
	})
	if err != nil {
		t.Fatalf("RenderAPPublicIngress returned error: %v", err)
	}
	if got := ingress.Labels[BrainResourceKindLabel]; got != ResourceKindEntryPointSupport {
		t.Fatalf("%s = %q, want %s", BrainResourceKindLabel, got, ResourceKindEntryPointSupport)
	}
	if got := ingress.Labels[LaunchpadAppDeployManagerDomainLabel]; got != "web.example.com" {
		t.Fatalf("%s = %q, want host", LaunchpadAppDeployManagerDomainLabel, got)
	}
	backend := ingress.Spec.Rules[0].HTTP.Paths[0].Backend.Service
	if backend == nil || backend.Name != "web-service" || backend.Port.Number != 8080 {
		t.Fatalf("unexpected ingress backend: %#v", backend)
	}
}

func TestEntryPointObjectFromIngressReturnsEntryPointLikeShape(t *testing.T) {
	ingress, err := RenderAPPublicIngress(APPublicIngressInput{
		APName:       "web",
		Host:         "web.example.com",
		Namespace:    "ns-a",
		ProjectID:    "project-a",
		PublicID:     "pa_abc",
		PublicKind:   "platform",
		ResourceName: "web-pa-abc",
		ServicePort:  8080,
	})
	if err != nil {
		t.Fatalf("RenderAPPublicIngress returned error: %v", err)
	}
	entryPoint := EntryPointObjectFromIngress(ingress)
	if got := entryPoint["kind"]; got != "EntryPoint" {
		t.Fatalf("kind = %v, want EntryPoint", got)
	}
	spec := entryPoint["spec"].(map[string]interface{})
	if got := spec["apRef"]; got != "web" {
		t.Fatalf("spec.apRef = %v, want web", got)
	}
	status := entryPoint["status"].(map[string]interface{})
	targets := status["targets"].([]interface{})
	target := targets[0].(map[string]interface{})
	if got := target["host"]; got != "web.example.com" {
		t.Fatalf("target.host = %v, want web.example.com", got)
	}
}

func TestAPObjectFromDeploymentReturnsAPLikeShape(t *testing.T) {
	resources, err := RenderAPResources(APResourcesInput{
		Image:       "nginx:1.27",
		Name:        "web",
		Namespace:   "ns-a",
		PrivatePort: 8080,
		ProjectID:   "project-a",
		Replicas:    2,
	})
	if err != nil {
		t.Fatalf("RenderAPResources returned error: %v", err)
	}
	resources.Deployment.Status.Replicas = 2
	resources.Deployment.Status.ReadyReplicas = 2
	resources.Deployment.Status.AvailableReplicas = 2
	ap := APObjectFromDeployment(resources.Deployment)
	if got := ap["kind"]; got != "AP" {
		t.Fatalf("kind = %v, want AP", got)
	}
	spec := ap["spec"].(map[string]interface{})
	input := spec["input"].(map[string]interface{})
	network := input["network"].(map[string]interface{})
	if got := input["image"]; got != "nginx:1.27" {
		t.Fatalf("spec.input.image = %v, want nginx:1.27", got)
	}
	if got := network["privatePort"]; got != int32(8080) {
		t.Fatalf("privatePort = %v, want 8080", got)
	}
	status := ap["status"].(map[string]interface{})
	if got := status["phase"]; got != "Running" {
		t.Fatalf("status.phase = %v, want Running", got)
	}
}

func TestRenderDBResourcesLabelsAndNames(t *testing.T) {
	resources, err := RenderDBResources(DBResourcesInput{
		ClusterVersion: "postgresql-16",
		Engine:         "postgresql",
		Name:           "pg",
		Namespace:      "ns-a",
		ProjectID:      "project-a",
		Replicas:       1,
	})
	if err != nil {
		t.Fatalf("RenderDBResources returned error: %v", err)
	}
	if resources.Cluster.GetName() != "pg" {
		t.Fatalf("cluster name = %q, want pg", resources.Cluster.GetName())
	}
	if resources.ExportService.Name != "pg-export" {
		t.Fatalf("export service name = %q, want pg-export", resources.ExportService.Name)
	}
	labels := resources.Cluster.GetLabels()
	if got := labels[BrainProjectIDLabel]; got != "project-a" {
		t.Fatalf("%s = %q, want project-a", BrainProjectIDLabel, got)
	}
	if got := labels[DBProviderClusterDefinitionLabel]; got != "postgresql" {
		t.Fatalf("%s = %q, want postgresql", DBProviderClusterDefinitionLabel, got)
	}
	if got := labels[DBProviderClusterVersionLabel]; got != "postgresql-16" {
		t.Fatalf("%s = %q, want postgresql-16", DBProviderClusterVersionLabel, got)
	}
	if got := resources.ExportService.Labels[DBProviderCRLabel]; got != "pg" {
		t.Fatalf("%s = %q, want pg", DBProviderCRLabel, got)
	}
}

func TestDBObjectFromClusterReturnsDBLikeShape(t *testing.T) {
	resources, err := RenderDBResources(DBResourcesInput{
		ClusterVersion: "postgresql-16",
		Engine:         "postgresql",
		Name:           "pg",
		Namespace:      "ns-a",
		ProjectID:      "project-a",
	})
	if err != nil {
		t.Fatalf("RenderDBResources returned error: %v", err)
	}
	resources.Cluster.Object["status"] = map[string]interface{}{
		"conditions": []interface{}{
			map[string]interface{}{"type": "Ready", "status": "True"},
		},
	}
	db := DBObjectFromCluster(resources.Cluster)
	if got := db["kind"]; got != "DB" {
		t.Fatalf("kind = %v, want DB", got)
	}
	spec := db["spec"].(map[string]interface{})
	if got := spec["engine"]; got != "postgresql" {
		t.Fatalf("spec.engine = %v, want postgresql", got)
	}
	status := db["status"].(map[string]interface{})
	if got := status["phase"]; got != "Running" {
		t.Fatalf("status.phase = %v, want Running", got)
	}
}

func TestRenderDBRestartOpsRequest(t *testing.T) {
	ops, err := RenderDBRestartOpsRequest("pg", "ns-a", time.Date(2026, 6, 2, 1, 2, 3, 0, time.UTC))
	if err != nil {
		t.Fatalf("RenderDBRestartOpsRequest returned error: %v", err)
	}
	if got := ops.GetName(); got != "pg-restart-20260602010203" {
		t.Fatalf("ops name = %q, want stable timestamp suffix", got)
	}
	spec := ops.Object["spec"].(map[string]interface{})
	if got := spec["clusterName"]; got != "pg" {
		t.Fatalf("clusterName = %v, want pg", got)
	}
	if got := spec["type"]; got != "Restart" {
		t.Fatalf("type = %v, want Restart", got)
	}
}
