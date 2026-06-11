package orchestration

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"regexp"
	"strings"

	appsv1 "k8s.io/api/apps/v1"
	autoscalingv2 "k8s.io/api/autoscaling/v2"
	corev1 "k8s.io/api/core/v1"
	networkingv1 "k8s.io/api/networking/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/util/intstr"
)

type APResourcesInput struct {
	Args             []string
	Command          []string
	ConfigMaps       []APConfigMapMount
	Env              []corev1.EnvVar
	EnvRawSource     string
	Image            string
	ImagePullSecrets []corev1.LocalObjectReference
	ImagePullPolicy  corev1.PullPolicy
	ImageRegistry    *APImageRegistry
	Name             string
	Namespace        string
	PrivatePort      int32
	ProjectID        string
	Replicas         int32
	LivenessProbe    *corev1.Probe
	ResourceLimit    corev1.ResourceList
	ResourceReq      corev1.ResourceList
	RoutingDomain    string
	NetworkJSON      string
	ReadinessProbe   *corev1.Probe
	ReplicaStrategy  *APReplicaStrategy
	RestartRequest   *int64
	Storage          []APStorageMount
	StorageTemplate  []APStorageMount
	StartupProbe     *corev1.Probe
	WorkloadKind     APWorkloadKind
}

type APResources struct {
	Deployment      *appsv1.Deployment
	ConfigMap       *corev1.ConfigMap
	HPA             *autoscalingv2.HorizontalPodAutoscaler
	ImagePullSecret *corev1.Secret
	Service         *corev1.Service
	StatefulSet     *appsv1.StatefulSet
}

type APWorkloadKind string

const (
	APWorkloadKindDeployment  APWorkloadKind = "deployment"
	APWorkloadKindStatefulSet APWorkloadKind = "statefulset"
)

const (
	APStorageMountPathAnnotation = "brain.io/mount-path"
	APStorageSizeAnnotation      = "brain.io/storage-size"
)

type APConfigMapMount struct {
	Path  string
	Value string
}

type APStorageMount struct {
	Path string
	Size string
}

type APImageRegistry struct {
	Password      string
	ServerAddress string
	Username      string
}

type APReplicaStrategy struct {
	Type    string
	Fixed   APFixedReplicaSettings
	Elastic *APElasticReplicaSettings
}

type APFixedReplicaSettings struct {
	Replicas int32
}

type APElasticReplicaSettings struct {
	MaxReplicas int32
	MinReplicas int32
	Target      APElasticReplicaTarget
}

type APElasticReplicaTarget struct {
	AverageValue       string
	Metric             string
	Type               string
	UtilizationPercent int32
}

func RenderAPResources(input APResourcesInput) (*APResources, error) {
	name := strings.TrimSpace(input.Name)
	namespace := strings.TrimSpace(input.Namespace)
	projectID := strings.TrimSpace(input.ProjectID)
	image := strings.TrimSpace(input.Image)
	if name == "" || namespace == "" || projectID == "" || image == "" {
		return nil, fmt.Errorf("name, namespace, projectID, and image are required")
	}
	appListeningPorts, err := NormalizeAPAppListeningPortsFromNetworkJSON(input.NetworkJSON, input.PrivatePort)
	if err != nil {
		return nil, err
	}
	replicaStrategy := normalizeAPReplicaStrategy(input.ReplicaStrategy, input.Replicas)
	replicas := replicaStrategy.Fixed.Replicas
	if replicaStrategy.Type == "elastic" && replicaStrategy.Elastic != nil {
		replicas = replicaStrategy.Elastic.MinReplicas
	}

	workloadKind, err := normalizeAPWorkloadKind(input.WorkloadKind, input.Storage)
	if err != nil {
		return nil, err
	}
	configMaps, err := normalizeAPConfigMapMounts(input.ConfigMaps)
	if err != nil {
		return nil, err
	}
	storage, err := normalizeAPStorageMounts(input.Storage)
	if err != nil {
		return nil, err
	}
	if err := validateAPVolumeNames(name, configMaps, storage); err != nil {
		return nil, err
	}
	storageTemplate := storage
	if len(input.StorageTemplate) > 0 {
		storageTemplate, err = normalizeAPStorageMounts(input.StorageTemplate)
		if err != nil {
			return nil, err
		}
		if err := validateAPVolumeNames(name, configMaps, storageTemplate); err != nil {
			return nil, err
		}
	}

	labels := mergeStringMap(
		brainLabels(projectID, ResourceKindAP, name),
		map[string]string{
			BrainAppNameLabel:              name,
			LaunchpadAppDeployManagerLabel: name,
			LaunchpadAppLabel:              name,
		},
	)
	managerLabels := mergeStringMap(
		brainLabels(projectID, ResourceKindAP, name),
		map[string]string{
			BrainAppNameLabel:              name,
			LaunchpadAppDeployManagerLabel: name,
		},
	)
	if domain := strings.TrimSpace(input.RoutingDomain); domain != "" {
		managerLabels[APRoutingDomainLabel] = domain
		labels[APRoutingDomainLabel] = domain
	}
	annotations := map[string]string{}
	if networkJSON := strings.TrimSpace(input.NetworkJSON); networkJSON != "" {
		annotations[APDesiredNetworkAnnotation] = networkJSON
	}
	if envRawSource := strings.TrimSpace(input.EnvRawSource); envRawSource != "" {
		annotations[APEnvRawSourceAnnotation] = input.EnvRawSource
	}
	if replicaStrategyJSON := apReplicaStrategyJSON(replicaStrategy); replicaStrategyJSON != "" {
		annotations[APReplicaStrategyAnnotation] = replicaStrategyJSON
	}
	if storageJSON := apStorageJSON(storage); storageJSON != "" {
		annotations[APDesiredStorageAnnotation] = storageJSON
	}
	if input.RestartRequest != nil {
		if *input.RestartRequest < 0 {
			return nil, fmt.Errorf("restartRequest must be non-negative")
		}
		annotations[APRestartRequestAnnotation] = fmt.Sprintf("%d", *input.RestartRequest)
	}
	imagePullSecrets := normalizeAPImagePullSecrets(input.ImagePullSecrets)
	var imagePullSecret *corev1.Secret
	if input.ImageRegistry != nil {
		imagePullSecret, err = renderAPImagePullSecret(name, namespace, managerLabels, input.ImageRegistry)
		if err != nil {
			return nil, err
		}
		imagePullSecrets = appendAPImagePullSecret(imagePullSecrets, imagePullSecret.Name)
	}
	requests := input.ResourceReq
	if requests == nil {
		requests = corev1.ResourceList{
			corev1.ResourceCPU:    resource.MustParse("200m"),
			corev1.ResourceMemory: resource.MustParse("256Mi"),
		}
	}
	limits := input.ResourceLimit
	if limits == nil {
		limits = corev1.ResourceList{
			corev1.ResourceCPU:    resource.MustParse("2000m"),
			corev1.ResourceMemory: resource.MustParse("2Gi"),
		}
	}

	podTemplate := apPodTemplate(apPodTemplateInput{
		Args:             input.Args,
		Command:          input.Command,
		ConfigMaps:       configMaps,
		Env:              input.Env,
		Image:            image,
		ImagePullSecrets: imagePullSecrets,
		ImagePullPolicy:  input.ImagePullPolicy,
		Labels:           labels,
		Limits:           limits,
		LivenessProbe:    input.LivenessProbe,
		Name:             name,
		Ports:            appListeningPorts,
		ReadinessProbe:   input.ReadinessProbe,
		Requests:         requests,
		StartupProbe:     input.StartupProbe,
		Storage:          storage,
	})

	service := &corev1.Service{
		TypeMeta: metav1.TypeMeta{
			APIVersion: "v1",
			Kind:       "Service",
		},
		ObjectMeta: metav1.ObjectMeta{
			Labels:    managerLabels,
			Name:      APServiceName(name),
			Namespace: namespace,
		},
		Spec: corev1.ServiceSpec{
			Ports:    apServicePorts(appListeningPorts),
			Selector: map[string]string{LaunchpadAppLabel: name},
			Type:     corev1.ServiceTypeClusterIP,
		},
	}

	resources := &APResources{
		ImagePullSecret: imagePullSecret,
		Service:         service,
	}
	if len(configMaps) > 0 {
		resources.ConfigMap = renderAPConfigMap(name, namespace, managerLabels, configMaps)
	}

	if workloadKind == APWorkloadKindStatefulSet {
		resources.StatefulSet = &appsv1.StatefulSet{
			TypeMeta: metav1.TypeMeta{
				APIVersion: "apps/v1",
				Kind:       "StatefulSet",
			},
			ObjectMeta: metav1.ObjectMeta{
				Annotations: annotations,
				Labels:      managerLabels,
				Name:        name,
				Namespace:   namespace,
			},
			Spec: appsv1.StatefulSetSpec{
				Replicas: &replicas,
				Selector: &metav1.LabelSelector{
					MatchLabels: map[string]string{LaunchpadAppLabel: name},
				},
				ServiceName:          APServiceName(name),
				Template:             podTemplate,
				VolumeClaimTemplates: apVolumeClaimTemplates(storageTemplate, managerLabels),
			},
		}
	} else {
		resources.Deployment = &appsv1.Deployment{
			TypeMeta: metav1.TypeMeta{
				APIVersion: "apps/v1",
				Kind:       "Deployment",
			},
			ObjectMeta: metav1.ObjectMeta{
				Annotations: annotations,
				Labels:      managerLabels,
				Name:        name,
				Namespace:   namespace,
			},
			Spec: appsv1.DeploymentSpec{
				Replicas: &replicas,
				Selector: &metav1.LabelSelector{
					MatchLabels: map[string]string{LaunchpadAppLabel: name},
				},
				Template: podTemplate,
			},
		}
	}

	if replicaStrategy.Type == "elastic" && replicaStrategy.Elastic != nil {
		resources.HPA = renderAPHPA(name, namespace, projectID, workloadKind, replicaStrategy.Elastic)
	}
	return resources, nil
}

type apPodTemplateInput struct {
	Args             []string
	Command          []string
	ConfigMaps       []APConfigMapMount
	Env              []corev1.EnvVar
	Image            string
	ImagePullSecrets []corev1.LocalObjectReference
	ImagePullPolicy  corev1.PullPolicy
	Labels           map[string]string
	Limits           corev1.ResourceList
	LivenessProbe    *corev1.Probe
	Name             string
	Ports            []APAppListeningPort
	ReadinessProbe   *corev1.Probe
	Requests         corev1.ResourceList
	StartupProbe     *corev1.Probe
	Storage          []APStorageMount
}

func apPodTemplate(input apPodTemplateInput) corev1.PodTemplateSpec {
	automountServiceAccountToken := false
	annotations := map[string]string{}
	volumes := []corev1.Volume{}
	volumeMounts := []corev1.VolumeMount{}
	if len(input.ConfigMaps) > 0 {
		annotations[APConfigMapChecksumAnnotation] = apConfigMapChecksum(input.ConfigMaps)
		volumeName := APConfigMapVolumeName(input.Name)
		volumes = append(volumes, corev1.Volume{
			Name: volumeName,
			VolumeSource: corev1.VolumeSource{
				ConfigMap: &corev1.ConfigMapVolumeSource{
					LocalObjectReference: corev1.LocalObjectReference{Name: APConfigMapName(input.Name)},
				},
			},
		})
		for _, item := range input.ConfigMaps {
			volumeMounts = append(volumeMounts, corev1.VolumeMount{
				MountPath: item.Path,
				Name:      volumeName,
				SubPath:   APConfigMapKey(item.Path),
			})
		}
	}
	for _, item := range input.Storage {
		volumeMounts = append(volumeMounts, corev1.VolumeMount{
			MountPath: item.Path,
			Name:      APStorageClaimName(item.Path),
		})
	}

	return corev1.PodTemplateSpec{
		ObjectMeta: metav1.ObjectMeta{
			Annotations: annotations,
			Labels:      input.Labels,
		},
		Spec: corev1.PodSpec{
			AutomountServiceAccountToken: &automountServiceAccountToken,
			Containers: []corev1.Container{
				{
					Args:            input.Args,
					Command:         input.Command,
					Env:             input.Env,
					Image:           input.Image,
					ImagePullPolicy: normalizeImagePullPolicy(input.ImagePullPolicy),
					LivenessProbe:   input.LivenessProbe,
					Name:            input.Name,
					Ports:           apContainerPorts(input.Ports),
					ReadinessProbe:  input.ReadinessProbe,
					Resources: corev1.ResourceRequirements{
						Limits:   input.Limits,
						Requests: input.Requests,
					},
					StartupProbe: input.StartupProbe,
					VolumeMounts: volumeMounts,
				},
			},
			ImagePullSecrets: input.ImagePullSecrets,
			SecurityContext: &corev1.PodSecurityContext{
				SeccompProfile: &corev1.SeccompProfile{Type: corev1.SeccompProfileTypeRuntimeDefault},
			},
			Volumes: volumes,
		},
	}
}

func apConfigMapChecksum(configMaps []APConfigMapMount) string {
	data, err := json.Marshal(configMaps)
	if err != nil {
		return ""
	}
	sum := sha256.Sum256(data)
	return fmt.Sprintf("%x", sum[:8])
}

func normalizeAPImagePullSecrets(items []corev1.LocalObjectReference) []corev1.LocalObjectReference {
	out := make([]corev1.LocalObjectReference, 0, len(items))
	seen := map[string]bool{}
	for _, item := range items {
		name := strings.TrimSpace(item.Name)
		if name == "" || seen[name] {
			continue
		}
		seen[name] = true
		out = append(out, corev1.LocalObjectReference{Name: name})
	}
	return out
}

func appendAPImagePullSecret(items []corev1.LocalObjectReference, name string) []corev1.LocalObjectReference {
	name = strings.TrimSpace(name)
	if name == "" {
		return items
	}
	for _, item := range items {
		if item.Name == name {
			return items
		}
	}
	return append(items, corev1.LocalObjectReference{Name: name})
}

func renderAPImagePullSecret(name, namespace string, labels map[string]string, registry *APImageRegistry) (*corev1.Secret, error) {
	if registry == nil {
		return nil, nil
	}
	serverAddress := strings.TrimSpace(registry.ServerAddress)
	username := strings.TrimSpace(registry.Username)
	password := strings.TrimSpace(registry.Password)
	if serverAddress == "" || username == "" || password == "" {
		return nil, fmt.Errorf("imageRegistry.serverAddress, username, and password are required")
	}
	auth := base64.StdEncoding.EncodeToString([]byte(username + ":" + password))
	data, err := json.Marshal(map[string]interface{}{
		"auths": map[string]interface{}{
			serverAddress: map[string]string{
				"auth":     auth,
				"password": password,
				"username": username,
			},
		},
	})
	if err != nil {
		return nil, err
	}
	return &corev1.Secret{
		TypeMeta: metav1.TypeMeta{
			APIVersion: "v1",
			Kind:       "Secret",
		},
		ObjectMeta: metav1.ObjectMeta{
			Labels:    labels,
			Name:      APImagePullSecretName(name),
			Namespace: namespace,
		},
		Data: map[string][]byte{
			corev1.DockerConfigJsonKey: data,
		},
		Type: corev1.SecretTypeDockerConfigJson,
	}, nil
}

func renderAPConfigMap(name, namespace string, labels map[string]string, configMaps []APConfigMapMount) *corev1.ConfigMap {
	data := map[string]string{}
	for _, item := range configMaps {
		data[APConfigMapKey(item.Path)] = item.Value
	}
	return &corev1.ConfigMap{
		TypeMeta: metav1.TypeMeta{
			APIVersion: "v1",
			Kind:       "ConfigMap",
		},
		ObjectMeta: metav1.ObjectMeta{
			Labels:    labels,
			Name:      APConfigMapName(name),
			Namespace: namespace,
		},
		Data: data,
	}
}

func apVolumeClaimTemplates(storage []APStorageMount, labels map[string]string) []corev1.PersistentVolumeClaim {
	out := make([]corev1.PersistentVolumeClaim, 0, len(storage))
	for _, item := range storage {
		out = append(out, corev1.PersistentVolumeClaim{
			ObjectMeta: metav1.ObjectMeta{
				Annotations: map[string]string{
					APStorageMountPathAnnotation: item.Path,
					APStorageSizeAnnotation:      item.Size,
				},
				Labels: labels,
				Name:   APStorageClaimName(item.Path),
			},
			Spec: corev1.PersistentVolumeClaimSpec{
				AccessModes: []corev1.PersistentVolumeAccessMode{corev1.ReadWriteOnce},
				Resources: corev1.VolumeResourceRequirements{
					Requests: corev1.ResourceList{
						corev1.ResourceStorage: resource.MustParse(item.Size),
					},
				},
			},
		})
	}
	return out
}

func normalizeAPWorkloadKind(kind APWorkloadKind, storage []APStorageMount) (APWorkloadKind, error) {
	switch kind {
	case "", APWorkloadKindDeployment, APWorkloadKindStatefulSet:
	default:
		return "", fmt.Errorf("unsupported AP workload kind %q", kind)
	}
	if len(storage) > 0 {
		if kind == APWorkloadKindDeployment {
			return "", fmt.Errorf("spec.input.storage requires workload.kind statefulset")
		}
		return APWorkloadKindStatefulSet, nil
	}
	if kind == APWorkloadKindStatefulSet {
		return APWorkloadKindStatefulSet, nil
	}
	return APWorkloadKindDeployment, nil
}

func normalizeAPConfigMapMounts(items []APConfigMapMount) ([]APConfigMapMount, error) {
	out := make([]APConfigMapMount, 0, len(items))
	seenPaths := map[string]bool{}
	seenKeys := map[string]bool{}
	for _, item := range items {
		path := strings.TrimSpace(item.Path)
		if path == "" {
			continue
		}
		if !strings.HasPrefix(path, "/") {
			return nil, fmt.Errorf("configMaps.path must be absolute: %s", path)
		}
		if seenPaths[path] {
			return nil, fmt.Errorf("duplicate configMap path: %s", path)
		}
		key := APConfigMapKey(path)
		if seenKeys[key] {
			return nil, fmt.Errorf("duplicate configMap key generated from path: %s", path)
		}
		seenPaths[path] = true
		seenKeys[key] = true
		out = append(out, APConfigMapMount{Path: path, Value: item.Value})
	}
	return out, nil
}

func normalizeAPStorageMounts(items []APStorageMount) ([]APStorageMount, error) {
	out := make([]APStorageMount, 0, len(items))
	seenPaths := map[string]bool{}
	seenNames := map[string]bool{}
	for _, item := range items {
		path := strings.TrimSpace(item.Path)
		if path == "" {
			continue
		}
		if !strings.HasPrefix(path, "/") {
			return nil, fmt.Errorf("storage.path must be absolute: %s", path)
		}
		size := strings.TrimSpace(item.Size)
		if size == "" {
			size = "1Gi"
		}
		if _, err := resource.ParseQuantity(size); err != nil {
			return nil, fmt.Errorf("invalid storage size %q: %w", size, err)
		}
		if seenPaths[path] {
			return nil, fmt.Errorf("duplicate storage path: %s", path)
		}
		name := APStorageClaimName(path)
		if seenNames[name] {
			return nil, fmt.Errorf("duplicate storage claim name generated from path: %s", path)
		}
		seenPaths[path] = true
		seenNames[name] = true
		out = append(out, APStorageMount{Path: path, Size: size})
	}
	return out, nil
}

func validateAPVolumeNames(apName string, configMaps []APConfigMapMount, storage []APStorageMount) error {
	if len(configMaps) == 0 || len(storage) == 0 {
		return nil
	}
	configVolumeName := APConfigMapVolumeName(apName)
	for _, item := range storage {
		if APStorageClaimName(item.Path) == configVolumeName {
			return fmt.Errorf("storage path %s conflicts with AP config map volume name %s", item.Path, configVolumeName)
		}
	}
	return nil
}

func apStorageJSON(storage []APStorageMount) string {
	if len(storage) == 0 {
		return ""
	}
	data, err := json.Marshal(storage)
	if err != nil {
		return ""
	}
	return string(data)
}

func APConfigMapName(apName string) string {
	return dns1035SupportName(apName, "ap", "-config", 63)
}

func APImagePullSecretName(apName string) string {
	return dns1035SupportName(apName, "ap", "-registry", 63)
}

func APConfigMapVolumeName(apName string) string {
	return dns1123VolumeName(APConfigMapName(apName))
}

func APConfigMapKey(path string) string {
	return dns1123VolumeName(path)
}

func APStorageClaimName(path string) string {
	return dns1123VolumeName(path)
}

func dns1123VolumeName(value string) string {
	base := strings.ToLower(strings.TrimSpace(value))
	base = strings.Trim(base, "/")
	base = strings.ReplaceAll(base, "_", "-")
	base = strings.ReplaceAll(base, ".", "-")
	base = apPublicAddressResourceNameUnsafeCharsPattern.ReplaceAllString(base, "-")
	base = strings.Trim(base, "-")
	if base == "" {
		base = "data"
	}
	if len(base) > 63 {
		base = strings.Trim(base[len(base)-63:], "-")
	}
	if base == "" {
		base = "data"
	}
	return base
}

func APWorkloadKindForStatefulSet(sts *appsv1.StatefulSet) APWorkloadKind {
	if sts == nil {
		return APWorkloadKindDeployment
	}
	return APWorkloadKindStatefulSet
}

func APWorkloadKindString(kind APWorkloadKind) string {
	if kind == APWorkloadKindStatefulSet {
		return "statefulset"
	}
	return "deployment"
}

func renderAPDeployment(name string, namespace string, annotations map[string]string, managerLabels map[string]string, replicas int32, podTemplate corev1.PodTemplateSpec) *appsv1.Deployment {
	return &appsv1.Deployment{
		TypeMeta: metav1.TypeMeta{
			APIVersion: "apps/v1",
			Kind:       "Deployment",
		},
		ObjectMeta: metav1.ObjectMeta{
			Annotations: annotations,
			Labels:      managerLabels,
			Name:        name,
			Namespace:   namespace,
		},
		Spec: appsv1.DeploymentSpec{
			Replicas: &replicas,
			Selector: &metav1.LabelSelector{
				MatchLabels: map[string]string{LaunchpadAppLabel: name},
			},
			Template: podTemplate,
		},
	}
}

func apContainerPorts(ports []APAppListeningPort) []corev1.ContainerPort {
	out := make([]corev1.ContainerPort, 0, len(ports))
	for _, port := range ports {
		out = append(out, corev1.ContainerPort{
			ContainerPort: port.Port,
			Name:          APPortName(port.Port),
			Protocol:      corev1.ProtocolTCP,
		})
	}
	return out
}

func apServicePorts(ports []APAppListeningPort) []corev1.ServicePort {
	out := make([]corev1.ServicePort, 0, len(ports))
	for _, port := range ports {
		out = append(out, corev1.ServicePort{
			Name:       APPortName(port.Port),
			Port:       port.Port,
			Protocol:   corev1.ProtocolTCP,
			TargetPort: intstr.FromInt32(port.Port),
		})
	}
	return out
}

func APServiceName(apName string) string {
	return dns1035SupportName(apName, "ap", "-service", 63)
}

func dns1035SupportName(name, prefix, suffix string, maxLen int) string {
	base := strings.ToLower(strings.TrimSpace(name))
	base = apPublicAddressResourceNameUnsafeCharsPattern.ReplaceAllString(base, "-")
	base = strings.Trim(base, "-")
	if base == "" {
		base = "resource"
	}
	if base[0] < 'a' || base[0] > 'z' {
		base = strings.Trim(prefix, "-") + "-" + base
	}
	limit := maxLen - len(suffix)
	if limit < 1 {
		limit = maxLen
	}
	if len(base) > limit {
		base = strings.TrimRight(base[:limit], "-")
	}
	out := base + suffix
	if len(out) > maxLen {
		out = strings.TrimRight(out[:maxLen], "-")
	}
	if out == "" || out[0] < 'a' || out[0] > 'z' {
		return strings.Trim(prefix, "-") + suffix
	}
	return out
}

func normalizeImagePullPolicy(policy corev1.PullPolicy) corev1.PullPolicy {
	switch policy {
	case corev1.PullAlways, corev1.PullIfNotPresent, corev1.PullNever:
		return policy
	default:
		return corev1.PullAlways
	}
}

func normalizeAPReplicaStrategy(strategy *APReplicaStrategy, fallbackReplicas int32) APReplicaStrategy {
	replicas := fallbackReplicas
	if replicas < 1 {
		replicas = 1
	}
	if strategy == nil {
		return APReplicaStrategy{
			Type:  "fixed",
			Fixed: APFixedReplicaSettings{Replicas: replicas},
		}
	}
	fixedReplicas := strategy.Fixed.Replicas
	if fixedReplicas < 1 {
		fixedReplicas = replicas
	}
	out := APReplicaStrategy{
		Type:  strings.TrimSpace(strategy.Type),
		Fixed: APFixedReplicaSettings{Replicas: fixedReplicas},
	}
	if out.Type != "elastic" {
		out.Type = "fixed"
		return out
	}
	elastic := strategy.Elastic
	if elastic == nil {
		out.Type = "fixed"
		return out
	}
	minReplicas := elastic.MinReplicas
	if minReplicas < 1 {
		minReplicas = 1
	}
	maxReplicas := elastic.MaxReplicas
	if maxReplicas < minReplicas {
		maxReplicas = minReplicas
	}
	targetMetric := strings.TrimSpace(elastic.Target.Metric)
	targetType := strings.TrimSpace(elastic.Target.Type)
	target := APElasticReplicaTarget{
		AverageValue:       strings.TrimSpace(elastic.Target.AverageValue),
		Metric:             targetMetric,
		Type:               targetType,
		UtilizationPercent: elastic.Target.UtilizationPercent,
	}
	if target.Metric == "memory" {
		target.Metric = "memory"
		target.Type = "averageValue"
		if target.AverageValue == "" {
			target.AverageValue = "512Mi"
		}
	} else {
		target.Metric = "cpu"
		target.Type = "utilization"
		if target.UtilizationPercent < 1 {
			target.UtilizationPercent = 80
		}
	}
	out.Elastic = &APElasticReplicaSettings{
		MaxReplicas: maxReplicas,
		MinReplicas: minReplicas,
		Target:      target,
	}
	return out
}

func apReplicaStrategyJSON(strategy APReplicaStrategy) string {
	value := map[string]interface{}{
		"fixed": map[string]interface{}{
			"replicas": strategy.Fixed.Replicas,
		},
		"type": strategy.Type,
	}
	if strategy.Type == "elastic" && strategy.Elastic != nil {
		target := map[string]interface{}{
			"metric": strategy.Elastic.Target.Metric,
			"type":   strategy.Elastic.Target.Type,
		}
		if strategy.Elastic.Target.Metric == "memory" {
			target["averageValue"] = strategy.Elastic.Target.AverageValue
		} else {
			target["utilizationPercent"] = strategy.Elastic.Target.UtilizationPercent
		}
		value["elastic"] = map[string]interface{}{
			"maxReplicas": strategy.Elastic.MaxReplicas,
			"minReplicas": strategy.Elastic.MinReplicas,
			"target":      target,
		}
	}
	bytes, err := json.Marshal(value)
	if err != nil {
		return ""
	}
	return string(bytes)
}

func renderAPHPA(name string, namespace string, projectID string, workloadKind APWorkloadKind, elastic *APElasticReplicaSettings) *autoscalingv2.HorizontalPodAutoscaler {
	minReplicas := elastic.MinReplicas
	metricName := corev1.ResourceCPU
	target := autoscalingv2.MetricTarget{Type: autoscalingv2.UtilizationMetricType}
	if elastic.Target.Metric == "memory" {
		metricName = corev1.ResourceMemory
		target.Type = autoscalingv2.AverageValueMetricType
		averageValue := resource.MustParse(elastic.Target.AverageValue)
		target.AverageValue = &averageValue
	} else {
		utilizationPercent := elastic.Target.UtilizationPercent
		target.AverageUtilization = &utilizationPercent
	}
	return &autoscalingv2.HorizontalPodAutoscaler{
		TypeMeta: metav1.TypeMeta{
			APIVersion: "autoscaling/v2",
			Kind:       "HorizontalPodAutoscaler",
		},
		ObjectMeta: metav1.ObjectMeta{
			Labels: mergeStringMap(
				brainLabels(projectID, ResourceKindAP, name),
				map[string]string{BrainAppNameLabel: name},
			),
			Name:      name,
			Namespace: namespace,
		},
		Spec: autoscalingv2.HorizontalPodAutoscalerSpec{
			MaxReplicas: elastic.MaxReplicas,
			MinReplicas: &minReplicas,
			Metrics: []autoscalingv2.MetricSpec{
				{
					Type: autoscalingv2.ResourceMetricSourceType,
					Resource: &autoscalingv2.ResourceMetricSource{
						Name:   metricName,
						Target: target,
					},
				},
			},
			ScaleTargetRef: autoscalingv2.CrossVersionObjectReference{
				APIVersion: "apps/v1",
				Kind:       apHPAWorkloadKind(workloadKind),
				Name:       name,
			},
		},
	}
}

func apHPAWorkloadKind(kind APWorkloadKind) string {
	if kind == APWorkloadKindStatefulSet {
		return "StatefulSet"
	}
	return "Deployment"
}

type APNetworkIngressInput struct {
	APName            string
	AppListeningPorts []APAppListeningPort
	CustomDomains     []APCustomDomainRequest
	Namespace         string
	PlatformAddresses []APPlatformAddressRequest
	ProjectID         string
	RoutingDomain     string
}

type APPlatformAddressRequest struct {
	DomainPrefix string
	ID           string
	Port         int32
}

type APCustomDomainRequest struct {
	Domain            string
	ID                string
	PlatformAddressID string
}

var apPublicAddressResourceNameUnsafeCharsPattern = regexp.MustCompile(`[^a-z0-9-]+`)
var apPlatformAddressDomainPrefixPattern = regexp.MustCompile(`^[a-z]{6}$`)

const shortNameAlphabet = "abcdefghijklmnopqrstuvwxyz"
const DefaultPlatformTLSSecretName = "wildcard-cert"
const ingressClassAnnotation = "kubernetes.io/ingress.class"
const ingressClassName = "nginx"
const nginxProxyBodySizeAnnotation = "nginx.ingress.kubernetes.io/proxy-body-size"
const nginxProxyBodySize = "32m"
const acmeIssuerEmail = "admin@sealos.io"
const acmeIssuerServer = "https://acme-v02.api.letsencrypt.org/directory"
const acmePrivateKeySecretName = "letsencrypt-prod"

func RenderAPPublicIngresses(input APNetworkIngressInput) ([]*networkingv1.Ingress, error) {
	objects, err := RenderAPPublicRoutingResources(input)
	if err != nil {
		return nil, err
	}
	ingresses := make([]*networkingv1.Ingress, 0, len(objects))
	for _, object := range objects {
		ingress, ok := object.(*networkingv1.Ingress)
		if ok {
			ingresses = append(ingresses, ingress)
		}
	}
	return ingresses, nil
}

func RenderAPPublicRoutingResources(input APNetworkIngressInput) ([]runtime.Object, error) {
	apName := strings.TrimSpace(input.APName)
	namespace := strings.TrimSpace(input.Namespace)
	projectID := strings.TrimSpace(input.ProjectID)
	routingDomain := strings.TrimSpace(input.RoutingDomain)
	if apName == "" || namespace == "" || projectID == "" {
		return nil, fmt.Errorf("apName, namespace, and projectID are required")
	}

	platformsByID := make(map[string]APPlatformAddressRequest, len(input.PlatformAddresses))
	targetPorts := APAppListeningPortSet(input.AppListeningPorts)
	objects := make([]runtime.Object, 0, len(input.PlatformAddresses)+(len(input.CustomDomains)*3))
	for _, address := range input.PlatformAddresses {
		id := strings.TrimSpace(address.ID)
		if id == "" {
			continue
		}
		port := address.Port
		if port <= 0 {
			port = 80
		}
		domainPrefix := APPlatformAddressDomainPrefix(namespace, apName, id, address.DomainPrefix)
		platformsByID[id] = APPlatformAddressRequest{DomainPrefix: domainPrefix, ID: id, Port: port}
		if len(targetPorts) > 0 && !targetPorts[port] {
			continue
		}
		host := PlatformAddressHost(namespace, apName, id, domainPrefix, routingDomain)
		if host == "" {
			continue
		}
		ingress, err := RenderAPPublicIngress(APPublicIngressInput{
			APName:        apName,
			DomainLabel:   domainPrefix,
			Host:          host,
			Namespace:     namespace,
			ProjectID:     projectID,
			PublicID:      id,
			PublicKind:    "platform",
			ResourceName:  APPublicAddressResourceName(apName, id),
			ServicePort:   port,
			TLSSecretName: DefaultPlatformTLSSecretName,
		})
		if err != nil {
			return nil, err
		}
		objects = append(objects, ingress)
	}

	for _, customDomain := range input.CustomDomains {
		id := strings.TrimSpace(customDomain.ID)
		host := strings.Trim(strings.ToLower(strings.TrimSpace(customDomain.Domain)), ".")
		platformID := strings.TrimSpace(customDomain.PlatformAddressID)
		platform, ok := platformsByID[platformID]
		if id == "" || host == "" || !ok {
			continue
		}
		if len(targetPorts) > 0 && !targetPorts[platform.Port] {
			continue
		}
		tlsSecretName := APCustomDomainTLSResourceName(apName, id)
		ingress, err := RenderAPPublicIngress(APPublicIngressInput{
			APName:        apName,
			DomainLabel:   platform.DomainPrefix,
			Host:          host,
			Namespace:     namespace,
			ProjectID:     projectID,
			PublicID:      id,
			PublicKind:    "custom-domain",
			ResourceName:  APPublicAddressResourceName(apName, id),
			ServicePort:   platform.Port,
			TLSSecretName: tlsSecretName,
		})
		if err != nil {
			return nil, err
		}
		issuer := RenderAPCustomDomainIssuer(apName, namespace, projectID, tlsSecretName)
		certificate := RenderAPCustomDomainCertificate(apName, namespace, projectID, tlsSecretName, host)
		objects = append(objects, issuer, certificate, ingress)
	}

	return objects, nil
}

func APPlatformAddressDomainPrefix(namespace string, name string, id string, domainPrefix string) string {
	prefix := strings.TrimSpace(strings.ToLower(domainPrefix))
	if apPlatformAddressDomainPrefixPattern.MatchString(prefix) {
		return prefix
	}
	namespace = strings.TrimSpace(namespace)
	name = strings.TrimSpace(name)
	id = strings.TrimSpace(id)
	if namespace == "" || name == "" || id == "" {
		return ""
	}
	return stableLowercaseLetters(fmt.Sprintf("%s/%s/%s", namespace, name, id), 6)
}

func APCustomDomainTLSResourceName(apName, customDomainID string) string {
	source := strings.TrimSpace(apName) + "/" + strings.TrimSpace(customDomainID)
	return "cd-" + stableLowercaseLetters(source, 6)
}

func RenderAPCustomDomainIssuer(apName, namespace, projectID, resourceName string) *unstructured.Unstructured {
	resourceName = strings.TrimSpace(resourceName)
	return &unstructured.Unstructured{Object: map[string]interface{}{
		"apiVersion": "cert-manager.io/v1",
		"kind":       "Issuer",
		"metadata": map[string]interface{}{
			"labels": mergeStringMap(
				brainLabels(strings.TrimSpace(projectID), ResourceKindEntryPointSupport, resourceName),
				map[string]string{
					BrainAppNameLabel:              strings.TrimSpace(apName),
					LaunchpadAppDeployManagerLabel: strings.TrimSpace(apName),
				},
			),
			"name":      resourceName,
			"namespace": strings.TrimSpace(namespace),
		},
		"spec": map[string]interface{}{
			"acme": map[string]interface{}{
				"email":  acmeIssuerEmail,
				"server": acmeIssuerServer,
				"privateKeySecretRef": map[string]interface{}{
					"name": acmePrivateKeySecretName,
				},
				"solvers": []interface{}{
					map[string]interface{}{
						"http01": map[string]interface{}{
							"ingress": map[string]interface{}{
								"class":       ingressClassName,
								"serviceType": "ClusterIP",
							},
						},
					},
				},
			},
		},
	}}
}

func RenderAPCustomDomainCertificate(apName, namespace, projectID, resourceName, host string) *unstructured.Unstructured {
	resourceName = strings.TrimSpace(resourceName)
	return &unstructured.Unstructured{Object: map[string]interface{}{
		"apiVersion": "cert-manager.io/v1",
		"kind":       "Certificate",
		"metadata": map[string]interface{}{
			"labels": mergeStringMap(
				brainLabels(strings.TrimSpace(projectID), ResourceKindEntryPointSupport, resourceName),
				map[string]string{
					BrainAppNameLabel:              strings.TrimSpace(apName),
					LaunchpadAppDeployManagerLabel: strings.TrimSpace(apName),
				},
			),
			"name":      resourceName,
			"namespace": strings.TrimSpace(namespace),
		},
		"spec": map[string]interface{}{
			"dnsNames": []interface{}{strings.TrimSpace(host)},
			"issuerRef": map[string]interface{}{
				"kind": "Issuer",
				"name": resourceName,
			},
			"secretName": resourceName,
		},
	}}
}

func APPublicAddressResourceName(apName, publicID string) string {
	source := strings.TrimSpace(apName) + "/" + strings.TrimSpace(publicID)
	return "ing-" + stableLowercaseLetters(source, 6)
}

func stableLowercaseLetters(source string, length int) string {
	if length <= 0 {
		return ""
	}
	sum := sha256.Sum256([]byte(strings.TrimSpace(source)))
	out := make([]byte, 0, length)
	for i := 0; len(out) < length; i++ {
		out = append(out, shortNameAlphabet[sum[i%len(sum)]%byte(len(shortNameAlphabet))])
	}
	return string(out)
}

func PlatformAddressHost(namespace string, name string, id string, domainPrefix string, domain string) string {
	namespace = strings.TrimSpace(namespace)
	name = strings.TrimSpace(name)
	id = strings.TrimSpace(id)
	domain = strings.TrimSpace(domain)
	if namespace == "" || name == "" || id == "" || domain == "" {
		return ""
	}
	label := APPlatformAddressDomainPrefix(namespace, name, id, domainPrefix)
	if label == "" {
		return ""
	}
	return fmt.Sprintf("%s.%s", label, domain)
}

type APPublicIngressInput struct {
	APName        string
	DomainLabel   string
	Host          string
	Namespace     string
	ProjectID     string
	PublicID      string
	PublicKind    string
	ServicePort   int32
	ResourceName  string
	TLSSecretName string
}

func RenderAPPublicIngress(input APPublicIngressInput) (*networkingv1.Ingress, error) {
	apName := strings.TrimSpace(input.APName)
	namespace := strings.TrimSpace(input.Namespace)
	projectID := strings.TrimSpace(input.ProjectID)
	host := strings.TrimSpace(input.Host)
	resourceName := strings.TrimSpace(input.ResourceName)
	if resourceName == "" {
		resourceName = dns1035SupportName(apName, "ap", "-ingress", 63)
	}
	if apName == "" || namespace == "" || projectID == "" || host == "" {
		return nil, fmt.Errorf("apName, namespace, projectID, and host are required")
	}
	port := input.ServicePort
	if port <= 0 {
		port = 80
	}
	domainLabel := strings.TrimSpace(input.DomainLabel)
	if domainLabel == "" {
		domainLabel = hostLabelValue(host)
	}
	pathType := networkingv1.PathTypePrefix
	labels := mergeStringMap(
		brainLabels(projectID, ResourceKindEntryPointSupport, resourceName),
		map[string]string{
			BrainAppNameLabel:                    apName,
			"brain.io/public-address-id":         strings.TrimSpace(input.PublicID),
			"brain.io/public-address-kind":       strings.TrimSpace(input.PublicKind),
			LaunchpadAppDeployManagerLabel:       apName,
			LaunchpadAppDeployManagerDomainLabel: domainLabel,
		},
	)
	spec := networkingv1.IngressSpec{
		Rules: []networkingv1.IngressRule{
			{
				Host: host,
				IngressRuleValue: networkingv1.IngressRuleValue{
					HTTP: &networkingv1.HTTPIngressRuleValue{
						Paths: []networkingv1.HTTPIngressPath{
							{
								Path:     "/",
								PathType: &pathType,
								Backend: networkingv1.IngressBackend{
									Service: &networkingv1.IngressServiceBackend{
										Name: APServiceName(apName),
										Port: networkingv1.ServiceBackendPort{Number: port},
									},
								},
							},
						},
					},
				},
			},
		},
	}
	tlsSecretName := strings.TrimSpace(input.TLSSecretName)
	if tlsSecretName != "" {
		spec.TLS = []networkingv1.IngressTLS{
			{
				Hosts:      []string{host},
				SecretName: tlsSecretName,
			},
		}
	}
	return &networkingv1.Ingress{
		TypeMeta: metav1.TypeMeta{
			APIVersion: "networking.k8s.io/v1",
			Kind:       "Ingress",
		},
		ObjectMeta: metav1.ObjectMeta{
			Annotations: map[string]string{
				LaunchpadAppDeployManagerDomainHostAnnotation: host,
				ingressClassAnnotation:                        ingressClassName,
				nginxProxyBodySizeAnnotation:                  nginxProxyBodySize,
			},
			Labels:    labels,
			Name:      resourceName,
			Namespace: namespace,
		},
		Spec: spec,
	}, nil
}

func hostLabelValue(host string) string {
	sum := sha256.Sum256([]byte(strings.TrimSpace(host)))
	return fmt.Sprintf("host-%x", sum[:8])
}
