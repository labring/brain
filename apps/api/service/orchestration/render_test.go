package orchestration

import (
	"regexp"
	"strings"
	"testing"
	"time"

	autoscalingv2 "k8s.io/api/autoscaling/v2"
	corev1 "k8s.io/api/core/v1"
	networkingv1 "k8s.io/api/networking/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/util/intstr"
)

var dns1035LabelPattern = regexp.MustCompile(`^[a-z]([-a-z0-9]*[a-z0-9])?$`)
var shortIngressNamePattern = regexp.MustCompile(`^ing-[a-z]{6}$`)

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

func TestRenderAPResourcesRendersMultipleAppListeningPorts(t *testing.T) {
	resources, err := RenderAPResources(APResourcesInput{
		Image:       "nginx:1.27",
		Name:        "web",
		Namespace:   "ns-a",
		NetworkJSON: `{"appListeningPorts":[{"port":80},{"port":3000}]}`,
		ProjectID:   "project-a",
	})
	if err != nil {
		t.Fatalf("RenderAPResources returned error: %v", err)
	}

	containerPorts := resources.Deployment.Spec.Template.Spec.Containers[0].Ports
	if got := len(containerPorts); got != 2 {
		t.Fatalf("container port count = %d, want 2", got)
	}
	if got := containerPorts[0].Name; got != "port-80" {
		t.Fatalf("container port[0].name = %q, want port-80", got)
	}
	if got := containerPorts[0].ContainerPort; got != 80 {
		t.Fatalf("container port[0] = %d, want 80", got)
	}
	if got := containerPorts[1].Name; got != "port-3000" {
		t.Fatalf("container port[1].name = %q, want port-3000", got)
	}
	if got := containerPorts[1].ContainerPort; got != 3000 {
		t.Fatalf("container port[1] = %d, want 3000", got)
	}

	servicePorts := resources.Service.Spec.Ports
	if got := len(servicePorts); got != 2 {
		t.Fatalf("service port count = %d, want 2", got)
	}
	if got := servicePorts[0].Name; got != "port-80" {
		t.Fatalf("service port[0].name = %q, want port-80", got)
	}
	if got := servicePorts[0].Port; got != 80 {
		t.Fatalf("service port[0] = %d, want 80", got)
	}
	if got := servicePorts[0].TargetPort.IntVal; got != 80 {
		t.Fatalf("service targetPort[0] = %d, want 80", got)
	}
	if got := servicePorts[1].Name; got != "port-3000" {
		t.Fatalf("service port[1].name = %q, want port-3000", got)
	}
	if got := servicePorts[1].Port; got != 3000 {
		t.Fatalf("service port[1] = %d, want 3000", got)
	}
	if got := servicePorts[1].TargetPort.IntVal; got != 3000 {
		t.Fatalf("service targetPort[1] = %d, want 3000", got)
	}
}

func TestRenderAPResourcesSetsSecurityDefaultsAndConfigChecksum(t *testing.T) {
	resources, err := RenderAPResources(APResourcesInput{
		ConfigMaps: []APConfigMapMount{
			{Path: "/etc/app/config.yaml", Value: "debug: true\n"},
		},
		Image:       "nginx:1.27",
		Name:        "web",
		Namespace:   "ns-a",
		PrivatePort: 8080,
		ProjectID:   "project-a",
	})
	if err != nil {
		t.Fatalf("RenderAPResources returned error: %v", err)
	}
	podSpec := resources.Deployment.Spec.Template.Spec
	if podSpec.AutomountServiceAccountToken == nil || *podSpec.AutomountServiceAccountToken {
		t.Fatal("automountServiceAccountToken = true/nil, want false")
	}
	if podSpec.SecurityContext == nil || podSpec.SecurityContext.SeccompProfile == nil {
		t.Fatal("pod seccomp profile missing")
	}
	if got := podSpec.SecurityContext.SeccompProfile.Type; got != corev1.SeccompProfileTypeRuntimeDefault {
		t.Fatalf("seccomp profile = %q, want RuntimeDefault", got)
	}
	if got := resources.Deployment.Spec.Template.Annotations[APConfigMapChecksumAnnotation]; got == "" {
		t.Fatal("config checksum annotation is empty")
	}
}

func TestRenderAPResourcesCreatesImagePullSecret(t *testing.T) {
	resources, err := RenderAPResources(APResourcesInput{
		Image: "registry.example.com/team/app:1.0",
		ImagePullSecrets: []corev1.LocalObjectReference{
			{Name: "external-registry"},
		},
		ImageRegistry: &APImageRegistry{
			Password:      "secret",
			ServerAddress: "registry.example.com",
			Username:      "alice",
		},
		Name:        "web",
		Namespace:   "ns-a",
		PrivatePort: 8080,
		ProjectID:   "project-a",
	})
	if err != nil {
		t.Fatalf("RenderAPResources returned error: %v", err)
	}
	if resources.ImagePullSecret == nil {
		t.Fatal("ImagePullSecret = nil, want generated docker config secret")
	}
	if got := resources.ImagePullSecret.Name; got != APImagePullSecretName("web") {
		t.Fatalf("secret name = %q, want generated name", got)
	}
	if got := resources.ImagePullSecret.Type; got != corev1.SecretTypeDockerConfigJson {
		t.Fatalf("secret type = %q, want dockerconfigjson", got)
	}
	secrets := resources.Deployment.Spec.Template.Spec.ImagePullSecrets
	if len(secrets) != 2 {
		t.Fatalf("imagePullSecrets length = %d, want 2", len(secrets))
	}
	if got := secrets[0].Name; got != "external-registry" {
		t.Fatalf("first imagePullSecret = %q, want external-registry", got)
	}
	if got := secrets[1].Name; got != APImagePullSecretName("web") {
		t.Fatalf("generated imagePullSecret = %q, want AP secret", got)
	}
}

func TestRenderAPResourcesRendersStatefulSetStorageAndConfigMap(t *testing.T) {
	resources, err := RenderAPResources(APResourcesInput{
		Args:      []string{"--config", "/etc/app/config.yaml"},
		Command:   []string{"/app/server"},
		Image:     "example/app:1.0",
		Name:      "web",
		Namespace: "ns-a",
		ConfigMaps: []APConfigMapMount{
			{Path: "/etc/app/config.yaml", Value: "port: 8080\n"},
		},
		PrivatePort: 8080,
		ProjectID:   "project-a",
		Storage: []APStorageMount{
			{Path: "/data", Size: "10Gi"},
		},
	})
	if err != nil {
		t.Fatalf("RenderAPResources returned error: %v", err)
	}
	if resources.Deployment != nil {
		t.Fatalf("Deployment = %#v, want nil for storage-backed AP", resources.Deployment)
	}
	if resources.StatefulSet == nil {
		t.Fatal("StatefulSet = nil, want rendered StatefulSet")
	}
	if resources.ConfigMap == nil {
		t.Fatal("ConfigMap = nil, want AP config map")
	}

	sts := resources.StatefulSet
	if got := sts.Spec.ServiceName; got != "web-service" {
		t.Fatalf("statefulset serviceName = %q, want web-service", got)
	}
	container := sts.Spec.Template.Spec.Containers[0]
	if got := strings.Join(container.Command, " "); got != "/app/server" {
		t.Fatalf("command = %q, want /app/server", got)
	}
	if got := strings.Join(container.Args, " "); got != "--config /etc/app/config.yaml" {
		t.Fatalf("args = %q, want --config /etc/app/config.yaml", got)
	}
	if got := len(sts.Spec.VolumeClaimTemplates); got != 1 {
		t.Fatalf("volumeClaimTemplates count = %d, want 1", got)
	}
	claim := sts.Spec.VolumeClaimTemplates[0]
	if got := claim.Name; got != "data" {
		t.Fatalf("claim name = %q, want data", got)
	}
	if got := claim.Annotations[APStorageMountPathAnnotation]; got != "/data" {
		t.Fatalf("claim mount path annotation = %q, want /data", got)
	}
	if got := claim.Spec.Resources.Requests.Storage().String(); got != "10Gi" {
		t.Fatalf("claim storage = %q, want 10Gi", got)
	}
	if got := container.VolumeMounts[0].Name; got != APConfigMapVolumeName("web") {
		t.Fatalf("config map mount name = %q, want AP config map volume name", got)
	}
	if got := container.VolumeMounts[0].MountPath; got != "/etc/app/config.yaml" {
		t.Fatalf("config map mountPath = %q, want file path", got)
	}
	if got := container.VolumeMounts[0].SubPath; got != "etc-app-config-yaml" {
		t.Fatalf("config map subPath = %q, want path-derived key", got)
	}
	if got := resources.ConfigMap.Data["etc-app-config-yaml"]; got != "port: 8080\n" {
		t.Fatalf("config map data = %q, want file contents", got)
	}
	if got := container.VolumeMounts[1].Name; got != "data" {
		t.Fatalf("storage mount name = %q, want data", got)
	}
	if got := container.VolumeMounts[1].MountPath; got != "/data" {
		t.Fatalf("storage mount path = %q, want /data", got)
	}
}

func TestRenderAPResourcesRejectsDeploymentWithStorage(t *testing.T) {
	_, err := RenderAPResources(APResourcesInput{
		Image:        "example/app:1.0",
		Name:         "web",
		Namespace:    "ns-a",
		PrivatePort:  8080,
		ProjectID:    "project-a",
		Storage:      []APStorageMount{{Path: "/data", Size: "10Gi"}},
		WorkloadKind: APWorkloadKindDeployment,
	})
	if err == nil {
		t.Fatal("RenderAPResources error = nil, want deployment plus storage rejection")
	}
}

func TestRenderAPResourcesRejectsConfigMapStorageVolumeNameCollision(t *testing.T) {
	_, err := RenderAPResources(APResourcesInput{
		ConfigMaps:  []APConfigMapMount{{Path: "/etc/app/config.yaml", Value: "port: 8080\n"}},
		Image:       "example/app:1.0",
		Name:        "web",
		Namespace:   "ns-a",
		PrivatePort: 8080,
		ProjectID:   "project-a",
		Storage:     []APStorageMount{{Path: "/web-config", Size: "10Gi"}},
	})
	if err == nil {
		t.Fatal("RenderAPResources error = nil, want configMap and storage volume name collision rejection")
	}
}

func TestRenderAPHPAUsesStatefulSetTargetForStorage(t *testing.T) {
	resources, err := RenderAPResources(APResourcesInput{
		Image:       "example/app:1.0",
		Name:        "web",
		Namespace:   "ns-a",
		ProjectID:   "project-a",
		PrivatePort: 8080,
		ReplicaStrategy: &APReplicaStrategy{
			Type: "elastic",
			Fixed: APFixedReplicaSettings{
				Replicas: 1,
			},
			Elastic: &APElasticReplicaSettings{
				MinReplicas: 2,
				MaxReplicas: 4,
				Target: APElasticReplicaTarget{
					Metric:             "cpu",
					Type:               "utilization",
					UtilizationPercent: 70,
				},
			},
		},
		Storage: []APStorageMount{{Path: "/data", Size: "10Gi"}},
	})
	if err != nil {
		t.Fatalf("RenderAPResources returned error: %v", err)
	}
	if resources.HPA == nil {
		t.Fatal("HPA = nil, want elastic scaling HPA")
	}
	if got := resources.HPA.Spec.ScaleTargetRef.Kind; got != "StatefulSet" {
		t.Fatalf("HPA target kind = %q, want StatefulSet", got)
	}
	if got := resources.HPA.Spec.Metrics[0].Resource.Target.Type; got != autoscalingv2.UtilizationMetricType {
		t.Fatalf("HPA target type = %q, want Utilization", got)
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
	if got := ingress.Annotations[ingressClassAnnotation]; got != ingressClassName {
		t.Fatalf("%s = %q, want %s", ingressClassAnnotation, got, ingressClassName)
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
			{DomainPrefix: "cbwfiu", ID: "pa_abc123", Port: 8080},
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
	if got := ingresses[0].Name; got != "ing-iromvs" {
		t.Fatalf("platform ingress name = %q, want stable short lowercase name", got)
	}
	if got := ingresses[0].Spec.Rules[0].Host; got != "cbwfiu.apps.example.com" {
		t.Fatalf("platform host = %q, want stable AP host", got)
	}
	if got := ingresses[0].Spec.TLS[0].SecretName; got != DefaultPlatformTLSSecretName {
		t.Fatalf("platform TLS secret = %q, want %s", got, DefaultPlatformTLSSecretName)
	}
	if got := ingresses[1].Name; got != "ing-wmflms" {
		t.Fatalf("custom-domain ingress name = %q, want stable short lowercase name", got)
	}
	if got := ingresses[1].Spec.Rules[0].Host; got != "www.example.com" {
		t.Fatalf("custom-domain host = %q, want www.example.com", got)
	}
	if got := ingresses[1].Labels["brain.io/public-address-kind"]; got != "custom-domain" {
		t.Fatalf("custom-domain kind label = %q, want custom-domain", got)
	}
}

func TestRenderAPPublicRoutingResourcesIncludesCustomDomainCertificateResources(t *testing.T) {
	objects, err := RenderAPPublicRoutingResources(APNetworkIngressInput{
		APName:    "api",
		Namespace: "default",
		PlatformAddresses: []APPlatformAddressRequest{
			{DomainPrefix: "cbwfiu", ID: "pa_abc123", Port: 8080},
		},
		CustomDomains: []APCustomDomainRequest{
			{Domain: "WWW.Example.COM.", ID: "cd_def456", PlatformAddressID: "pa_abc123"},
		},
		ProjectID:     "project-a",
		RoutingDomain: "apps.example.com",
	})
	if err != nil {
		t.Fatalf("RenderAPPublicRoutingResources returned error: %v", err)
	}
	if got := len(objects); got != 4 {
		t.Fatalf("object count = %d, want platform ingress plus issuer, certificate, custom ingress", got)
	}
	issuer, ok := objects[1].(*unstructured.Unstructured)
	if !ok || issuer.GetKind() != "Issuer" {
		t.Fatalf("objects[1] = %#v, want Issuer", objects[1])
	}
	certificate, ok := objects[2].(*unstructured.Unstructured)
	if !ok || certificate.GetKind() != "Certificate" {
		t.Fatalf("objects[2] = %#v, want Certificate", objects[2])
	}
	secretName, _, _ := unstructured.NestedString(certificate.Object, "spec", "secretName")
	if secretName == "" || secretName != issuer.GetName() {
		t.Fatalf("certificate secretName = %q, issuer name = %q, want same custom resource name", secretName, issuer.GetName())
	}
}

func TestRenderAPPublicRoutingResourcesSkipsMissingTargetPorts(t *testing.T) {
	objects, err := RenderAPPublicRoutingResources(APNetworkIngressInput{
		APName: "api",
		AppListeningPorts: []APAppListeningPort{
			{Port: 8080},
		},
		CustomDomains: []APCustomDomainRequest{
			{Domain: "www.example.com", ID: "cd_def456", PlatformAddressID: "pa_def456"},
		},
		Namespace: "default",
		PlatformAddresses: []APPlatformAddressRequest{
			{DomainPrefix: "cbwfiu", ID: "pa_abc123", Port: 8080},
			{DomainPrefix: "hndpda", ID: "pa_def456", Port: 9000},
		},
		ProjectID:     "project-a",
		RoutingDomain: "apps.example.com",
	})
	if err != nil {
		t.Fatalf("RenderAPPublicRoutingResources returned error: %v", err)
	}
	if got := len(objects); got != 1 {
		t.Fatalf("object count = %d, want only routable platform ingress", got)
	}
	ingress, ok := objects[0].(*networkingv1.Ingress)
	if !ok {
		t.Fatalf("objects[0] = %#v, want Ingress", objects[0])
	}
	if got := ingress.Spec.Rules[0].HTTP.Paths[0].Backend.Service.Port.Number; got != 8080 {
		t.Fatalf("ingress service port = %d, want 8080", got)
	}
	if got := ingress.Spec.Rules[0].Host; got != "cbwfiu.apps.example.com" {
		t.Fatalf("ingress host = %q, want routable platform host", got)
	}
}

func TestAPPublicAddressResourceNameIsShortLowercaseMetadataName(t *testing.T) {
	name := APPublicAddressResourceName("ap-571800", "pa_jrjjio000000")
	if !shortIngressNamePattern.MatchString(name) {
		t.Fatalf("public ingress name = %q, want ing- plus 6 lowercase letters", name)
	}
	if !dns1035LabelPattern.MatchString(name) {
		t.Fatalf("public ingress name = %q, want DNS-1035 metadata.name", name)
	}
	if strings.Contains(name, "571800") || strings.Contains(name, "jrjjio") {
		t.Fatalf("public ingress name = %q, should not include AP name or public address id", name)
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
	restartRequest := int64(7)
	resources, err := RenderAPResources(APResourcesInput{
		Image: "nginx:1.27",
		ImagePullSecrets: []corev1.LocalObjectReference{
			{Name: "registry-secret"},
		},
		Name:        "web",
		Namespace:   "ns-a",
		PrivatePort: 8080,
		ProjectID:   "project-a",
		Replicas:    2,
		ResourceLimit: corev1.ResourceList{
			corev1.ResourceCPU:    resource.MustParse("500m"),
			corev1.ResourceMemory: resource.MustParse("512Mi"),
		},
		RestartRequest: &restartRequest,
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
	imagePullSecrets := input["imagePullSecrets"].([]interface{})
	imagePullSecret := imagePullSecrets[0].(map[string]interface{})
	if got := imagePullSecret["name"]; got != "registry-secret" {
		t.Fatalf("imagePullSecrets[0].name = %v, want registry-secret", got)
	}
	if got := spec["projectId"]; got != "project-a" {
		t.Fatalf("spec.projectId = %v, want project-a", got)
	}
	if got := spec["restartRequest"]; got != int64(7) {
		t.Fatalf("spec.restartRequest = %v, want 7", got)
	}
	if got := network["privatePort"]; got != int32(8080) {
		t.Fatalf("privatePort = %v, want 8080", got)
	}
	appListeningPorts := network["appListeningPorts"].([]interface{})
	appListeningPort := appListeningPorts[0].(map[string]interface{})
	if got := appListeningPort["port"]; got != int32(8080) {
		t.Fatalf("spec.input.network.appListeningPorts[0].port = %v, want 8080", got)
	}
	status := ap["status"].(map[string]interface{})
	statusNetwork := status["network"].(map[string]interface{})
	if got := statusNetwork["privateAddress"]; got != "http://web-service.ns-a.svc.cluster.local:8080" {
		t.Fatalf("status.network.privateAddress = %v, want generated private address", got)
	}
	statusPorts := statusNetwork["appListeningPorts"].([]interface{})
	statusPort := statusPorts[0].(map[string]interface{})
	if got := statusPort["privateAddress"]; got != "http://web-service.ns-a.svc.cluster.local:8080" {
		t.Fatalf("status.network.appListeningPorts[0].privateAddress = %v, want generated private address", got)
	}
	resourceSpec := spec["resource"].(map[string]interface{})
	limits := resourceSpec["limits"].(map[string]interface{})
	if got := limits["cpu"]; got != "500m" {
		t.Fatalf("cpu limit = %v, want 500m", got)
	}
	if got := limits["memory"]; got != "512Mi" {
		t.Fatalf("memory limit = %v, want 512Mi", got)
	}
	if got := status["phase"]; got != "Running" {
		t.Fatalf("status.phase = %v, want Running", got)
	}
}

func TestAPObjectFromStatefulSetReturnsAPLikeShape(t *testing.T) {
	resources, err := RenderAPResources(APResourcesInput{
		Args:      []string{"--config", "/etc/app/config.yaml"},
		Command:   []string{"/app/server"},
		Image:     "example/app:1.0",
		Name:      "web",
		Namespace: "ns-a",
		ConfigMaps: []APConfigMapMount{
			{Path: "/etc/app/config.yaml", Value: "port: 8080\n"},
		},
		PrivatePort: 8080,
		ProjectID:   "project-a",
		Storage: []APStorageMount{
			{Path: "/data", Size: "10Gi"},
		},
	})
	if err != nil {
		t.Fatalf("RenderAPResources returned error: %v", err)
	}
	resources.StatefulSet.Status.Replicas = 1
	resources.StatefulSet.Status.ReadyReplicas = 1
	ap := APObjectFromStatefulSet(resources.StatefulSet)
	if got := ap["kind"]; got != "AP" {
		t.Fatalf("kind = %v, want AP", got)
	}
	spec := ap["spec"].(map[string]interface{})
	workload := spec["workload"].(map[string]interface{})
	if got := workload["kind"]; got != "statefulset" {
		t.Fatalf("spec.workload.kind = %v, want statefulset", got)
	}
	input := spec["input"].(map[string]interface{})
	command := input["command"].([]string)
	if got := command[0]; got != "/app/server" {
		t.Fatalf("command[0] = %v, want /app/server", got)
	}
	configMaps := input["configMaps"].([]interface{})
	configMap := configMaps[0].(map[string]interface{})
	if got := configMap["path"]; got != "/etc/app/config.yaml" {
		t.Fatalf("configMaps[0].path = %v, want /etc/app/config.yaml", got)
	}
	storage := input["storage"].([]interface{})
	volume := storage[0].(map[string]interface{})
	if got := volume["path"]; got != "/data" {
		t.Fatalf("storage[0].path = %v, want /data", got)
	}
	if got := volume["size"]; got != "10Gi" {
		t.Fatalf("storage[0].size = %v, want 10Gi", got)
	}
	status := ap["status"].(map[string]interface{})
	if got := status["configVersionHash"]; got == "" {
		t.Fatal("status.configVersionHash is empty")
	}
	if got := status["phase"]; got != "Running" {
		t.Fatalf("status.phase = %v, want Running", got)
	}
}

func TestAPObjectFromDeploymentGeneratesPrivateAddressForDefaultPortAndDNSSafeService(t *testing.T) {
	resources, err := RenderAPResources(APResourcesInput{
		Image:       "nginx:1.27",
		Name:        "4ebacadd-d705-493f-9302-c4c54e51fb61-nfxk",
		Namespace:   "ns-a",
		PrivatePort: 80,
		ProjectID:   "project-a",
	})
	if err != nil {
		t.Fatalf("RenderAPResources returned error: %v", err)
	}

	ap := APObjectFromDeployment(resources.Deployment)
	status := ap["status"].(map[string]interface{})
	network := status["network"].(map[string]interface{})
	if got := network["privateAddress"]; got != "http://ap-4ebacadd-d705-493f-9302-c4c54e51fb61-nfxk-service.ns-a.svc.cluster.local" {
		t.Fatalf("status.network.privateAddress = %v, want generated DNS-safe private address", got)
	}
}

func TestRenderAPResourcesPreservesValueFromAndProbes(t *testing.T) {
	startup := corev1.Probe{
		ProbeHandler: corev1.ProbeHandler{
			HTTPGet: &corev1.HTTPGetAction{Path: "/ready", Port: intstr.FromInt(8080)},
		},
		FailureThreshold: 30,
	}
	readiness := corev1.Probe{
		ProbeHandler: corev1.ProbeHandler{
			HTTPGet: &corev1.HTTPGetAction{Path: "/healthz", Port: intstr.FromInt(8080)},
		},
		InitialDelaySeconds: 5,
		FailureThreshold:    3,
	}
	resources, err := RenderAPResources(APResourcesInput{
		Env: []corev1.EnvVar{
			{
				Name: "DATABASE_PASSWORD",
				ValueFrom: &corev1.EnvVarSource{
					SecretKeyRef: &corev1.SecretKeySelector{
						LocalObjectReference: corev1.LocalObjectReference{Name: "pg-conn-credential"},
						Key:                  "password",
					},
				},
			},
		},
		Image:          "nginx:1.27",
		Name:           "web",
		Namespace:      "ns-a",
		PrivatePort:    8080,
		ProjectID:      "project-a",
		StartupProbe:   &startup,
		ReadinessProbe: &readiness,
	})
	if err != nil {
		t.Fatalf("RenderAPResources returned error: %v", err)
	}
	container := resources.Deployment.Spec.Template.Spec.Containers[0]
	if container.Env[0].ValueFrom == nil || container.Env[0].ValueFrom.SecretKeyRef == nil {
		t.Fatalf("env valueFrom was not preserved: %#v", container.Env[0])
	}
	if got := container.Env[0].ValueFrom.SecretKeyRef.Name; got != "pg-conn-credential" {
		t.Fatalf("secret name = %q, want pg-conn-credential", got)
	}
	if container.StartupProbe == nil || container.StartupProbe.HTTPGet == nil {
		t.Fatalf("startup probe was not rendered: %#v", container.StartupProbe)
	}
	if got := container.StartupProbe.HTTPGet.Path; got != "/ready" {
		t.Fatalf("startup path = %q, want /ready", got)
	}
	if container.ReadinessProbe == nil || container.ReadinessProbe.HTTPGet == nil {
		t.Fatalf("readiness probe was not rendered: %#v", container.ReadinessProbe)
	}
	if got := container.ReadinessProbe.HTTPGet.Path; got != "/healthz" {
		t.Fatalf("readiness path = %q, want /healthz", got)
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
	envRawSource := "\n# database\nDATABASE_URL=postgres://db\n"
	resources, err := RenderAPResources(APResourcesInput{
		EnvRawSource:  envRawSource,
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
	if got := input["envRawSource"]; got != envRawSource {
		t.Fatalf("envRawSource = %v, want raw source", got)
	}
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
	if got := statusAddress["host"]; got != "ojqzfl.apps.example.com" {
		t.Fatalf("status public host = %v, want stable host", got)
	}
	if got := resources.Deployment.Labels[APRoutingDomainLabel]; got != "apps.example.com" {
		t.Fatalf("routing domain label = %q, want apps.example.com", got)
	}
	if got := resources.Deployment.Annotations[APDesiredNetworkAnnotation]; got == "" {
		t.Fatalf("desired network annotation should be set")
	}
	if got := resources.Deployment.Annotations[APEnvRawSourceAnnotation]; got != envRawSource {
		t.Fatalf("env raw source annotation = %q, want raw source", got)
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

func TestRenderDBResourcesAppliesQuotaAndResourceOverrides(t *testing.T) {
	resources, err := RenderDBResources(DBResourcesInput{
		CPULimit:      "1500m",
		CPURequest:    "500m",
		Engine:        "postgresql",
		MemoryLimit:   "2Gi",
		MemoryRequest: "1Gi",
		Name:          "pg",
		Namespace:     "ns-a",
		ProjectID:     "project-a",
		Quota:         "m",
		StorageSize:   "20Gi",
	})
	if err != nil {
		t.Fatalf("RenderDBResources returned error: %v", err)
	}
	spec := resources.Cluster.Object["spec"].(map[string]interface{})
	component := spec["componentSpecs"].([]interface{})[0].(map[string]interface{})
	resourcesSpec := component["resources"].(map[string]interface{})
	requests := resourcesSpec["requests"].(map[string]interface{})
	if got := requests["cpu"]; got != "500m" {
		t.Fatalf("cpu request = %v, want 500m", got)
	}
	if got := requests["memory"]; got != "1Gi" {
		t.Fatalf("memory request = %v, want 1Gi", got)
	}
	limits := resourcesSpec["limits"].(map[string]interface{})
	if got := limits["cpu"]; got != "1500m" {
		t.Fatalf("cpu limit = %v, want 1500m", got)
	}
	if got := limits["memory"]; got != "2Gi" {
		t.Fatalf("memory limit = %v, want 2Gi", got)
	}
}

func TestRenderDBResourcesAddsRestoreSourceWithoutChangingInheritedSettings(t *testing.T) {
	resources, err := RenderDBResources(DBResourcesInput{
		BackupPolicy: map[string]interface{}{
			"enabled": true,
			"method":  "pg-basebackup",
		},
		CPULimit:       "1500m",
		CPURequest:     "500m",
		ClusterVersion: "postgresql-16",
		Engine:         "postgresql",
		MemoryLimit:    "2Gi",
		MemoryRequest:  "1Gi",
		Name:           "orders-restore",
		Namespace:      "database-system",
		ProjectID:      "project-a",
		Replicas:       2,
		RestoreFromBackup: &DBRestoreFromBackupInput{
			BackupName:      "orders-manual-20260609",
			BackupNamespace: "database-system",
		},
		StorageSize: "20Gi",
	})
	if err != nil {
		t.Fatalf("RenderDBResources returned error: %v", err)
	}

	spec := resources.Cluster.Object["spec"].(map[string]interface{})
	annotations := resources.Cluster.GetAnnotations()
	restore := annotations["kubeblocks.io/restore-from-backup"]
	if restore == "" {
		t.Fatal("missing kubeblocks restore-from-backup annotation")
	}
	if !strings.Contains(restore, `"postgresql"`) {
		t.Fatalf("restore annotation = %q, want postgresql component key", restore)
	}
	if !strings.Contains(restore, `"name":"orders-manual-20260609"`) {
		t.Fatalf("restore annotation = %q, want orders-manual-20260609 backup", restore)
	}
	if !strings.Contains(restore, `"namespace":"database-system"`) {
		t.Fatalf("restore annotation = %q, want database-system namespace", restore)
	}
	if !strings.Contains(restore, `"volumeRestorePolicy":"Parallel"`) {
		t.Fatalf("restore annotation = %q, want Parallel volume restore policy", restore)
	}
	component := spec["componentSpecs"].([]interface{})[0].(map[string]interface{})
	backupPolicy := spec["backup"].(map[string]interface{})
	if got := backupPolicy["method"]; got != "pg-basebackup" {
		t.Fatalf("backup method = %v, want inherited pg-basebackup", got)
	}
	if got := component["replicas"]; got != int64(2) {
		t.Fatalf("restored component replicas = %v, want inherited replicas 2", got)
	}
	resourcesSpec := component["resources"].(map[string]interface{})
	requests := resourcesSpec["requests"].(map[string]interface{})
	limits := resourcesSpec["limits"].(map[string]interface{})
	if got := requests["cpu"]; got != "500m" {
		t.Fatalf("restored cpu request = %v, want inherited 500m", got)
	}
	if got := limits["memory"]; got != "2Gi" {
		t.Fatalf("restored memory limit = %v, want inherited 2Gi", got)
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
		Replicas:       2,
		StorageSize:    "20Gi",
	})
	if err != nil {
		t.Fatalf("RenderDBResources returned error: %v", err)
	}
	component := resources.Cluster.Object["spec"].(map[string]interface{})["componentSpecs"].([]interface{})[0].(map[string]interface{})
	component["resources"] = map[string]interface{}{
		"limits": map[string]interface{}{
			"cpu":    "500m",
			"memory": "1Gi",
		},
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
	if got := spec["replicas"]; got != int64(2) {
		t.Fatalf("spec.replicas = %v, want 2", got)
	}
	if got := spec["cpuLimit"]; got != "500m" {
		t.Fatalf("spec.cpuLimit = %v, want 500m", got)
	}
	if got := spec["memoryLimit"]; got != "1Gi" {
		t.Fatalf("spec.memoryLimit = %v, want 1Gi", got)
	}
	if got := spec["storageSize"]; got != "20Gi" {
		t.Fatalf("spec.storageSize = %v, want 20Gi", got)
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
