package orchestration

import (
	"strings"
	"testing"
	"time"

	corev1 "k8s.io/api/core/v1"
	networkingv1 "k8s.io/api/networking/v1"
	"k8s.io/apimachinery/pkg/api/resource"
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

func TestRenderAPResourcesUsesDNSSafeSupportResourceNames(t *testing.T) {
	resources, err := RenderAPResources(APResourcesInput{
		Image:       "nginx:1.27",
		Name:        "4ebacadd-d705-493f-9302-c4c54e51fb61-nfxk",
		Namespace:   "ns-a",
		PrivatePort: 8080,
		ProjectID:   "project-a",
		Replicas:    1,
	})
	if err != nil {
		t.Fatalf("RenderAPResources returned error: %v", err)
	}
	if got := resources.Deployment.Name; got != "4ebacadd-d705-493f-9302-c4c54e51fb61-nfxk" {
		t.Fatalf("deployment name = %q, want logical AP name unchanged", got)
	}
	if got := resources.Service.Name; !strings.HasPrefix(got, "ap-4ebacadd") {
		t.Fatalf("service name = %q, want DNS-safe AP support name", got)
	}
	if got := resources.Service.Spec.Selector[LaunchpadAppLabel]; got != "4ebacadd-d705-493f-9302-c4c54e51fb61-nfxk" {
		t.Fatalf("service selector app label = %q, want logical AP name", got)
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
	if got := ingress.Labels[LaunchpadAppDeployManagerDomainLabel]; got == "" || got == "web.example.com" {
		t.Fatalf("%s = %q, want stable short host key", LaunchpadAppDeployManagerDomainLabel, got)
	}
	if got := ingress.Annotations[LaunchpadAppDeployManagerDomainHostAnnotation]; got != "web.example.com" {
		t.Fatalf("%s = %q, want full host", LaunchpadAppDeployManagerDomainHostAnnotation, got)
	}
	backend := ingress.Spec.Rules[0].HTTP.Paths[0].Backend.Service
	if backend == nil || backend.Name != "web-service" || backend.Port.Number != 8080 {
		t.Fatalf("unexpected ingress backend: %#v", backend)
	}
}

func TestRenderAPPublicIngressKeepsLongHostOutOfLabels(t *testing.T) {
	longHost := strings.Repeat("very-long-segment-", 5) + "example.192.168.10.189.nip.io"
	ingress, err := RenderAPPublicIngress(APPublicIngressInput{
		APName:       "web",
		Host:         longHost,
		Namespace:    "ns-a",
		ProjectID:    "project-a",
		PublicID:     "pa_abc123",
		PublicKind:   "platform",
		ResourceName: "web-pa-abc123",
		ServicePort:  8080,
	})
	if err != nil {
		t.Fatalf("RenderAPPublicIngress returned error: %v", err)
	}
	if got := ingress.Spec.Rules[0].Host; got != longHost {
		t.Fatalf("spec host = %q, want full host", got)
	}
	domainLabel := ingress.Labels[LaunchpadAppDeployManagerDomainLabel]
	if len(domainLabel) > 63 {
		t.Fatalf("domain compatibility label length = %d, want <= 63", len(domainLabel))
	}
	if domainLabel == longHost {
		t.Fatalf("domain compatibility label must not contain full host")
	}
	if got := ingress.Annotations[LaunchpadAppDeployManagerDomainHostAnnotation]; got != longHost {
		t.Fatalf("host annotation = %q, want full host", got)
	}
}

func TestRenderAPPublicIngressesFromNetworkIntent(t *testing.T) {
	ingresses, err := RenderAPPublicIngresses(APNetworkIngressInput{
		APName:    "api",
		Namespace: "default",
		PlatformAddresses: []APPlatformAddressRequest{
			{ID: "pa_abc123", Port: 8080},
		},
		CustomDomains: []APCustomDomainRequest{
			{Domain: "WWW.Example.COM.", ID: "cd_def456", PlatformAddressID: "pa_abc123"},
		},
		ProjectID:     "project-a",
		RoutingDomain: "apps.example.com",
	})
	if err != nil {
		t.Fatalf("RenderAPPublicIngresses returned error: %v", err)
	}
	if got := len(ingresses); got != 2 {
		t.Fatalf("ingress count = %d, want 2", got)
	}
	if got := ingresses[0].Name; got != "api-pa-abc123" {
		t.Fatalf("platform ingress name = %q, want api-pa-abc123", got)
	}
	if got := ingresses[0].Spec.Rules[0].Host; got != "api-7c6ad52581.apps.example.com" {
		t.Fatalf("platform host = %q, want stable AP host", got)
	}
	if got := ingresses[1].Name; got != "api-cd-def456" {
		t.Fatalf("custom-domain ingress name = %q, want api-cd-def456", got)
	}
	if got := ingresses[1].Spec.Rules[0].Host; got != "www.example.com" {
		t.Fatalf("custom-domain host = %q, want www.example.com", got)
	}
	if got := ingresses[1].Labels["brain.io/public-address-kind"]; got != "custom-domain" {
		t.Fatalf("custom-domain kind label = %q, want custom-domain", got)
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
	metadata := entryPoint["metadata"].(map[string]interface{})
	if got := metadata["name"]; got != "web" {
		t.Fatalf("metadata.name = %v, want AP-bound name web", got)
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

func TestEntryPointObjectsFromIngressesAggregatesOneNodePerAP(t *testing.T) {
	platformIngress, err := RenderAPPublicIngress(APPublicIngressInput{
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
	customIngress, err := RenderAPPublicIngress(APPublicIngressInput{
		APName:       "web",
		Host:         "www.example.com",
		Namespace:    "ns-a",
		ProjectID:    "project-a",
		PublicID:     "cd_def",
		PublicKind:   "custom-domain",
		ResourceName: "web-cd-def",
		ServicePort:  8080,
	})
	if err != nil {
		t.Fatalf("RenderAPPublicIngress returned error: %v", err)
	}

	entryPoints := EntryPointObjectsFromIngresses([]networkingv1.Ingress{
		*platformIngress,
		*customIngress,
	})
	if got := len(entryPoints); got != 1 {
		t.Fatalf("entryPoints length = %d, want 1", got)
	}
	metadata := entryPoints[0]["metadata"].(map[string]interface{})
	if got := metadata["name"]; got != "web" {
		t.Fatalf("metadata.name = %v, want web", got)
	}
	status := entryPoints[0]["status"].(map[string]interface{})
	targets := status["targets"].([]interface{})
	if got := len(targets); got != 2 {
		t.Fatalf("targets length = %d, want 2", got)
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
		ResourceLimit: corev1.ResourceList{
			corev1.ResourceCPU:    resource.MustParse("500m"),
			corev1.ResourceMemory: resource.MustParse("512Mi"),
		},
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
	resourceSpec := spec["resource"].(map[string]interface{})
	limits := resourceSpec["limits"].(map[string]interface{})
	if got := limits["cpu"]; got != "500m" {
		t.Fatalf("cpu limit = %v, want 500m", got)
	}
	if got := limits["memory"]; got != "512Mi" {
		t.Fatalf("memory limit = %v, want 512Mi", got)
	}
	status := ap["status"].(map[string]interface{})
	if got := status["phase"]; got != "Running" {
		t.Fatalf("status.phase = %v, want Running", got)
	}
}

func TestRenderAPResourcesElasticReplicaStrategyCreatesHPA(t *testing.T) {
	resources, err := RenderAPResources(APResourcesInput{
		Image:       "nginx:1.27",
		Name:        "web",
		Namespace:   "ns-a",
		PrivatePort: 8080,
		ProjectID:   "project-a",
		ReplicaStrategy: &APReplicaStrategy{
			Fixed: APFixedReplicaSettings{Replicas: 2},
			Type:  "elastic",
			Elastic: &APElasticReplicaSettings{
				MaxReplicas: 8,
				MinReplicas: 2,
				Target: APElasticReplicaTarget{
					Metric:             "cpu",
					Type:               "utilization",
					UtilizationPercent: 75,
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("RenderAPResources returned error: %v", err)
	}
	if resources.HPA == nil {
		t.Fatal("expected HPA for elastic AP")
	}
	if got := resources.HPA.Labels[BrainProjectIDLabel]; got != "project-a" {
		t.Fatalf("HPA project label = %q, want project-a", got)
	}
	if resources.Deployment.Spec.Replicas == nil || *resources.Deployment.Spec.Replicas != 2 {
		t.Fatalf("deployment replicas = %v, want elastic minReplicas 2", resources.Deployment.Spec.Replicas)
	}
	if got := resources.HPA.Spec.MaxReplicas; got != 8 {
		t.Fatalf("HPA maxReplicas = %d, want 8", got)
	}
	if got := resources.HPA.Spec.Metrics[0].Resource.Target.AverageUtilization; got == nil || *got != 75 {
		t.Fatalf("HPA CPU utilization = %v, want 75", got)
	}

	ap := APObjectFromDeployment(resources.Deployment)
	resourceSpec := ap["spec"].(map[string]interface{})["resource"].(map[string]interface{})
	replicaStrategy := resourceSpec["replicaStrategy"].(map[string]interface{})
	if got := replicaStrategy["type"]; got != "elastic" {
		t.Fatalf("replicaStrategy.type = %v, want elastic", got)
	}
}

func TestAPObjectFromDeploymentRestoresDesiredNetworkAnnotation(t *testing.T) {
	resources, err := RenderAPResources(APResourcesInput{
		Image:         "nginx:1.27",
		Name:          "web",
		Namespace:     "ns-a",
		NetworkJSON:   `{"privatePort":8080,"platformAddresses":[{"id":"pa_abc123","port":8080}]}`,
		PrivatePort:   8080,
		ProjectID:     "project-a",
		RoutingDomain: "apps.example.com",
	})
	if err != nil {
		t.Fatalf("RenderAPResources returned error: %v", err)
	}
	ap := APObjectFromDeployment(resources.Deployment)
	spec := ap["spec"].(map[string]interface{})
	input := spec["input"].(map[string]interface{})
	network := input["network"].(map[string]interface{})
	addresses := network["platformAddresses"].([]interface{})
	address := addresses[0].(map[string]interface{})
	if got := address["id"]; got != "pa_abc123" {
		t.Fatalf("platform address id = %v, want pa_abc123", got)
	}
	status := ap["status"].(map[string]interface{})
	statusNetwork := status["network"].(map[string]interface{})
	statusAddresses := statusNetwork["publicAddresses"].([]interface{})
	statusAddress := statusAddresses[0].(map[string]interface{})
	if got := statusAddress["host"]; got != "web-c4d9789bef.apps.example.com" {
		t.Fatalf("status public host = %v, want stable host", got)
	}
	if got := resources.Deployment.Labels[APRoutingDomainLabel]; got != "apps.example.com" {
		t.Fatalf("routing domain label = %q, want apps.example.com", got)
	}
	if got := resources.Deployment.Annotations[APDesiredNetworkAnnotation]; got == "" {
		t.Fatalf("desired network annotation should be set")
	}
}

func TestRenderDBResourcesLabelsAndNames(t *testing.T) {
	resources, err := RenderDBResources(DBResourcesInput{
		ClusterVersion: "postgresql-16",
		Engine:         "postgresql",
		ExposeNodePort: true,
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
	if got := resources.ExportService.APIVersion; got != "v1" {
		t.Fatalf("export service apiVersion = %q, want v1", got)
	}
}

func TestRenderDBResourcesOmitsExportServiceWhenPublicAccessDisabled(t *testing.T) {
	resources, err := RenderDBResources(DBResourcesInput{
		Engine:    "postgresql",
		Name:      "pg",
		Namespace: "ns-a",
		ProjectID: "project-a",
	})
	if err != nil {
		t.Fatalf("RenderDBResources returned error: %v", err)
	}
	if resources.ExportService != nil {
		t.Fatalf("export service should be nil when ExposeNodePort is false")
	}
}

func TestRenderDBResourcesDefaultsClusterVersion(t *testing.T) {
	resources, err := RenderDBResources(DBResourcesInput{
		Engine:    "postgresql",
		Name:      "pg",
		Namespace: "ns-a",
		ProjectID: "project-a",
	})
	if err != nil {
		t.Fatalf("RenderDBResources returned error: %v", err)
	}
	spec := resources.Cluster.Object["spec"].(map[string]interface{})
	if got := spec["clusterVersionRef"]; got != "postgresql-16.4.0" {
		t.Fatalf("clusterVersionRef = %v, want postgresql-16.4.0", got)
	}
	if got := resources.Cluster.GetLabels()[DBProviderClusterVersionLabel]; got != "postgresql-16.4.0" {
		t.Fatalf("%s = %q, want postgresql-16.4.0", DBProviderClusterVersionLabel, got)
	}
}

func TestRenderDBResourcesUsesEngineProfiles(t *testing.T) {
	tests := []struct {
		name              string
		engine            string
		wantDefinition    string
		wantVersion       string
		wantComponent     string
		wantPort          int32
		wantTargetPort    string
		wantProductEngine string
	}{
		{
			name:              "mysql",
			engine:            "mysql",
			wantDefinition:    "apecloud-mysql",
			wantVersion:       "ac-mysql-8.0.30",
			wantComponent:     "mysql",
			wantPort:          3306,
			wantTargetPort:    "mysql",
			wantProductEngine: "mysql",
		},
		{
			name:              "redis",
			engine:            "redis",
			wantDefinition:    "redis",
			wantVersion:       "redis-7.2.7",
			wantComponent:     "redis",
			wantPort:          6379,
			wantTargetPort:    "redis",
			wantProductEngine: "redis",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			resources, err := RenderDBResources(DBResourcesInput{
				Engine:         tt.engine,
				ExposeNodePort: true,
				Name:           tt.name,
				Namespace:      "ns-a",
				ProjectID:      "project-a",
			})
			if err != nil {
				t.Fatalf("RenderDBResources returned error: %v", err)
			}
			spec := resources.Cluster.Object["spec"].(map[string]interface{})
			if got := spec["clusterDefinitionRef"]; got != tt.wantDefinition {
				t.Fatalf("clusterDefinitionRef = %v, want %s", got, tt.wantDefinition)
			}
			if got := spec["clusterVersionRef"]; got != tt.wantVersion {
				t.Fatalf("clusterVersionRef = %v, want %s", got, tt.wantVersion)
			}
			components := spec["componentSpecs"].([]interface{})
			component := components[0].(map[string]interface{})
			if got := component["componentDefRef"]; got != tt.wantComponent {
				t.Fatalf("componentDefRef = %v, want %s", got, tt.wantComponent)
			}
			if got := component["name"]; got != tt.wantComponent {
				t.Fatalf("component name = %v, want %s", got, tt.wantComponent)
			}
			labels := resources.Cluster.GetLabels()
			if got := labels[BrainDBEngineLabel]; got != tt.wantProductEngine {
				t.Fatalf("%s = %q, want %s", BrainDBEngineLabel, got, tt.wantProductEngine)
			}
			if got := labels[DBProviderClusterDefinitionLabel]; got != tt.wantDefinition {
				t.Fatalf("%s = %q, want %s", DBProviderClusterDefinitionLabel, got, tt.wantDefinition)
			}
			port := resources.ExportService.Spec.Ports[0]
			if got := port.Port; got != tt.wantPort {
				t.Fatalf("export service port = %d, want %d", got, tt.wantPort)
			}
			if got := port.TargetPort.String(); got != tt.wantTargetPort {
				t.Fatalf("export service targetPort = %s, want %s", got, tt.wantTargetPort)
			}
			if got := resources.ExportService.Spec.Selector["apps.kubeblocks.io/component-name"]; got != tt.wantComponent {
				t.Fatalf("export service component selector = %q, want %s", got, tt.wantComponent)
			}
		})
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
	ops, err := RenderDBRestartOpsRequest("pg", "ns-a", "mysql", time.Date(2026, 6, 2, 1, 2, 3, 0, time.UTC))
	if err != nil {
		t.Fatalf("RenderDBRestartOpsRequest returned error: %v", err)
	}
	if got := ops.GetName(); got != "pg-restart-20260602010203" {
		t.Fatalf("ops name = %q, want stable timestamp suffix", got)
	}
	spec := ops.Object["spec"].(map[string]interface{})
	if got := spec["clusterRef"]; got != "pg" {
		t.Fatalf("clusterRef = %v, want pg", got)
	}
	if got := spec["type"]; got != "Restart" {
		t.Fatalf("type = %v, want Restart", got)
	}
	restart := spec["restart"].([]interface{})
	component := restart[0].(map[string]interface{})
	if got := component["componentName"]; got != "mysql" {
		t.Fatalf("restart componentName = %v, want mysql", got)
	}
}

func TestRenderDBScalingOpsRequestsUseClusterRef(t *testing.T) {
	now := time.Date(2026, 6, 2, 1, 2, 3, 0, time.UTC)
	horizontal, err := RenderDBHorizontalScalingOpsRequest("pg", "ns-a", "postgresql", 3, now)
	if err != nil {
		t.Fatalf("RenderDBHorizontalScalingOpsRequest returned error: %v", err)
	}
	horizontalSpec := horizontal.Object["spec"].(map[string]interface{})
	if got := horizontalSpec["clusterRef"]; got != "pg" {
		t.Fatalf("horizontal clusterRef = %v, want pg", got)
	}
	items := horizontalSpec["horizontalScaling"].([]interface{})
	item := items[0].(map[string]interface{})
	if got := item["replicas"]; got != int64(3) {
		t.Fatalf("horizontal replicas = %v, want 3", got)
	}

	vertical, err := RenderDBVerticalScalingOpsRequest("pg", "ns-a", "postgresql", DBVerticalScalingInput{
		CPULimit:      "2000m",
		MemoryRequest: "1Gi",
	}, now)
	if err != nil {
		t.Fatalf("RenderDBVerticalScalingOpsRequest returned error: %v", err)
	}
	verticalSpec := vertical.Object["spec"].(map[string]interface{})
	if got := verticalSpec["clusterRef"]; got != "pg" {
		t.Fatalf("vertical clusterRef = %v, want pg", got)
	}
	verticalItems := verticalSpec["verticalScaling"].([]interface{})
	verticalItem := verticalItems[0].(map[string]interface{})
	if got := verticalItem["componentName"]; got != "postgresql" {
		t.Fatalf("vertical componentName = %v, want postgresql", got)
	}
}
