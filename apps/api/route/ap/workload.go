package ap

import (
	"encoding/json"
	"errors"
	"strings"
	"sync"

	"golang.org/x/sync/errgroup"
	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/api/resource"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	clientcmdapi "k8s.io/client-go/tools/clientcmd/api"

	k8ssvc "sealos/api/service/k8s"
	orchestration "sealos/api/service/orchestration"
	aptransform "sealos/api/service/transform/ap"
)

type apWorkload struct {
	Deployment  *appsv1.Deployment
	StatefulSet *appsv1.StatefulSet
}

func (workload apWorkload) Name() string {
	if workload.Deployment != nil {
		return workload.Deployment.Name
	}
	if workload.StatefulSet != nil {
		return workload.StatefulSet.Name
	}
	return ""
}

func (workload apWorkload) Namespace() string {
	if workload.Deployment != nil {
		return workload.Deployment.Namespace
	}
	if workload.StatefulSet != nil {
		return workload.StatefulSet.Namespace
	}
	return ""
}

func (workload apWorkload) Resource() string {
	if workload.StatefulSet != nil {
		return "statefulsets"
	}
	return "deployments"
}

func (workload apWorkload) RolloutResource() string {
	if workload.StatefulSet != nil {
		return "statefulset"
	}
	return "deployment"
}

func (workload apWorkload) Annotations() map[string]string {
	if workload.Deployment != nil {
		return workload.Deployment.Annotations
	}
	if workload.StatefulSet != nil {
		return workload.StatefulSet.Annotations
	}
	return nil
}

func (workload apWorkload) Labels() map[string]string {
	if workload.Deployment != nil {
		return workload.Deployment.Labels
	}
	if workload.StatefulSet != nil {
		return workload.StatefulSet.Labels
	}
	return nil
}

func (workload apWorkload) PodLabels() map[string]string {
	if workload.Deployment != nil {
		return workload.Deployment.Spec.Template.Labels
	}
	if workload.StatefulSet != nil {
		return workload.StatefulSet.Spec.Template.Labels
	}
	return nil
}

func (workload apWorkload) APObject() map[string]interface{} {
	if workload.Deployment != nil {
		return orchestration.APObjectFromDeployment(workload.Deployment)
	}
	if workload.StatefulSet != nil {
		return orchestration.APObjectFromStatefulSet(workload.StatefulSet)
	}
	return nil
}

func currentAPWorkload(cfg *clientcmdapi.Config, namespace, name string) (*apWorkload, error) {
	if strings.TrimSpace(name) == "" {
		return nil, apierrors.NewBadRequest("name is required")
	}
	deploymentJSON, deploymentErr := k8ssvc.Get(cfg, k8ssvc.GetOptions{Resource: "deployments", Name: name, Namespace: namespace})
	var deployment *appsv1.Deployment
	if deploymentErr == nil {
		var current appsv1.Deployment
		if err := json.Unmarshal(deploymentJSON, &current); err != nil {
			return nil, err
		}
		if err := requireLaunchpadAPDeployment(current); err != nil {
			return nil, apierrors.NewNotFound(schema.GroupResource{Group: "apps", Resource: "deployments"}, name)
		}
		deployment = &current
	} else if !apierrors.IsNotFound(deploymentErr) {
		return nil, deploymentErr
	}

	statefulSetJSON, statefulSetErr := k8ssvc.Get(cfg, k8ssvc.GetOptions{Resource: "statefulsets", Name: name, Namespace: namespace})
	var statefulSet *appsv1.StatefulSet
	if statefulSetErr == nil {
		var current appsv1.StatefulSet
		if err := json.Unmarshal(statefulSetJSON, &current); err != nil {
			return nil, err
		}
		if err := requireLaunchpadAPStatefulSet(current); err != nil {
			return nil, apierrors.NewNotFound(schema.GroupResource{Group: "apps", Resource: "statefulsets"}, name)
		}
		statefulSet = &current
	} else if !apierrors.IsNotFound(statefulSetErr) {
		return nil, statefulSetErr
	}

	if deployment != nil && statefulSet != nil {
		return nil, errors.New("AP has both Deployment and StatefulSet backing workloads")
	}
	if deployment != nil {
		return &apWorkload{Deployment: deployment}, nil
	}
	if statefulSet != nil {
		return &apWorkload{StatefulSet: statefulSet}, nil
	}
	return nil, apierrors.NewNotFound(schema.GroupResource{Group: "brain.io", Resource: "aps"}, name)
}

func apWorkloadLabelSelector(extra string) string {
	base := orchestration.LaunchpadAppDeployManagerLabel + "," +
		orchestration.BrainManagedByLabel + "=" + orchestration.BrainManagedByValue + "," +
		orchestration.BrainProjectIDLabel
	extra = strings.TrimSpace(extra)
	if extra == "" {
		return base
	}
	return base + "," + extra
}

func apLikeWorkloadLabelSelectors(extra string) []string {
	return []string{apWorkloadLabelSelector(extra)}
}

func apResponseFromWorkload(workload *apWorkload) (json.RawMessage, error) {
	if workload == nil {
		return nil, apierrors.NewNotFound(schema.GroupResource{Group: "brain.io", Resource: "aps"}, "")
	}
	return json.Marshal(workload.APObject())
}

func apResponseFromWorkloadWithConfigMapValues(cfg *clientcmdapi.Config, workload *apWorkload) (json.RawMessage, error) {
	if workload == nil {
		return nil, apierrors.NewNotFound(schema.GroupResource{Group: "brain.io", Resource: "aps"}, "")
	}
	apObject := workload.APObject()
	apObject, err := apObjectWithPublicAccessSupportResources(cfg, *workload, apObject)
	if err != nil {
		return nil, err
	}
	configMaps, err := currentAPConfigMapMounts(cfg, *workload)
	if err != nil {
		return nil, err
	}
	apObject = apObjectWithConfigMapValues(apObject, configMaps)
	storageStatus, err := currentAPStorageStatus(cfg, *workload, apObject)
	if err != nil {
		return nil, err
	}
	return json.Marshal(apObjectWithStorageStatus(apObject, storageStatus))
}

func apObjectWithPublicAccessSupportResources(cfg *clientcmdapi.Config, workload apWorkload, apObject map[string]interface{}) (map[string]interface{}, error) {
	ingresses, err := currentAPPublicAccessSupportResources(cfg, workload, "ingresses")
	if err != nil {
		return nil, err
	}
	services, err := currentAPPublicAccessSupportResources(cfg, workload, "services")
	if err != nil {
		return nil, err
	}
	certificates, err := currentAPPublicAccessSupportResources(cfg, workload, "certificates")
	if err != nil {
		return nil, err
	}
	issuers, err := currentAPPublicAccessSupportResources(cfg, workload, "issuers")
	if err != nil {
		return nil, err
	}
	return aptransform.APWithPublicAccessSupportResourcesFromList(apObject, ingresses, services, certificates, issuers), nil
}

func currentAPPublicAccessSupportResources(cfg *clientcmdapi.Config, workload apWorkload, resource string) ([]map[string]interface{}, error) {
	jsonBytes, err := k8ssvc.Get(cfg, k8ssvc.GetOptions{
		LabelSelector: apPublicRoutingSupportSelector(workload.Name(), workloadProjectID(workload)),
		Namespace:     workload.Namespace(),
		Resource:      resource,
	})
	if apierrors.IsNotFound(err) || k8ssvc.IsUnknownResourceError(err, resource) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var list unstructured.UnstructuredList
	if err := json.Unmarshal(jsonBytes, &list); err != nil {
		return nil, err
	}
	items := make([]map[string]interface{}, 0, len(list.Items))
	for i := range list.Items {
		items = append(items, list.Items[i].Object)
	}
	return items, nil
}

func apObjectWithConfigMapValues(apObject map[string]interface{}, configMaps []orchestration.APConfigMapMount) map[string]interface{} {
	if len(configMaps) == 0 {
		return apObject
	}
	spec, _ := apObject["spec"].(map[string]interface{})
	input, _ := spec["input"].(map[string]interface{})
	rows, _ := input["configMaps"].([]interface{})
	if len(rows) == 0 {
		return apObject
	}
	valuesByPath := make(map[string]string, len(configMaps))
	for _, item := range configMaps {
		valuesByPath[item.Path] = item.Value
	}
	for _, row := range rows {
		item, _ := row.(map[string]interface{})
		if item == nil {
			continue
		}
		path, _ := item["path"].(string)
		if value, ok := valuesByPath[path]; ok {
			item["value"] = value
		}
	}
	return apObject
}

func apObjectWithStorageStatus(apObject map[string]interface{}, storageStatus []interface{}) map[string]interface{} {
	if len(storageStatus) == 0 {
		return apObject
	}
	status, _ := apObject["status"].(map[string]interface{})
	if status == nil {
		status = map[string]interface{}{}
		apObject["status"] = status
	}
	status["storage"] = storageStatus
	return apObject
}

func currentAPStorageStatus(cfg *clientcmdapi.Config, workload apWorkload, apObject map[string]interface{}) ([]interface{}, error) {
	if workload.StatefulSet == nil {
		return nil, nil
	}
	var pvcJSON []byte
	for _, selector := range apStorageStatusSelectors(workload) {
		nextJSON, err := k8ssvc.Get(cfg, k8ssvc.GetOptions{
			LabelSelector: selector,
			Namespace:     workload.Namespace(),
			Resource:      "persistentvolumeclaims",
		})
		if apierrors.IsNotFound(err) || k8ssvc.IsUnknownResourceError(err, "persistentvolumeclaims") {
			continue
		}
		if err != nil {
			return nil, err
		}
		pvcJSON = mergeK8sListJSON(pvcJSON, nextJSON)
	}
	if len(pvcJSON) == 0 {
		return nil, nil
	}
	var list corev1.PersistentVolumeClaimList
	if err := json.Unmarshal(pvcJSON, &list); err != nil {
		var unstructuredList unstructured.UnstructuredList
		if unmarshalErr := json.Unmarshal(pvcJSON, &unstructuredList); unmarshalErr != nil {
			return nil, err
		}
		for i := range unstructuredList.Items {
			var pvc corev1.PersistentVolumeClaim
			if convertErr := runtime.DefaultUnstructuredConverter.FromUnstructured(unstructuredList.Items[i].Object, &pvc); convertErr != nil {
				return nil, convertErr
			}
			list.Items = append(list.Items, pvc)
		}
	}
	desiredByPath := apDesiredStorageRowsFromObject(apObject)
	out := make([]interface{}, 0, len(list.Items))
	for _, pvc := range list.Items {
		path := strings.TrimSpace(pvc.Annotations[orchestration.APStorageMountPathAnnotation])
		if path == "" {
			path = strings.TrimSpace(pvc.Annotations["path"])
		}
		if path == "" {
			continue
		}
		currentSize := ""
		if pvc.Spec.Resources.Requests != nil {
			currentSize = pvc.Spec.Resources.Requests.Storage().String()
		}
		desiredSize := strings.TrimSpace(pvc.Annotations[orchestration.APStorageSizeAnnotation])
		if desiredSize == "" {
			desiredSize = desiredByPath[path]
		}
		row := map[string]interface{}{
			"currentSize": currentSize,
			"name":        pvc.Name,
			"path":        path,
			"phase":       string(pvc.Status.Phase),
		}
		if desiredSize != "" {
			row["desiredSize"] = desiredSize
		}
		if storageResizePending(currentSize, desiredSize) {
			row["resizePending"] = true
		}
		out = append(out, row)
	}
	return out, nil
}

func apStorageStatusSelectors(workload apWorkload) []string {
	return []string{apPublicRoutingSupportSelector(workload.Name(), workloadProjectID(workload))}
}

func workloadProjectID(workload apWorkload) string {
	return strings.TrimSpace(workload.Labels()[orchestration.BrainProjectIDLabel])
}

func apDesiredStorageRowsFromObject(apObject map[string]interface{}) map[string]string {
	out := map[string]string{}
	spec, _ := apObject["spec"].(map[string]interface{})
	input, _ := spec["input"].(map[string]interface{})
	rows, _ := input["storage"].([]interface{})
	for _, row := range rows {
		item, _ := row.(map[string]interface{})
		if item == nil {
			continue
		}
		path, _ := item["path"].(string)
		size, _ := item["size"].(string)
		if strings.TrimSpace(path) != "" && strings.TrimSpace(size) != "" {
			out[strings.TrimSpace(path)] = strings.TrimSpace(size)
		}
	}
	return out
}

func storageResizePending(currentSize, desiredSize string) bool {
	currentQuantity, err := resource.ParseQuantity(strings.TrimSpace(currentSize))
	if err != nil {
		return false
	}
	desiredQuantity, err := resource.ParseQuantity(strings.TrimSpace(desiredSize))
	if err != nil {
		return false
	}
	return desiredQuantity.Cmp(currentQuantity) > 0
}

func apResponseFromWorkloadLists(deploymentJSON, statefulSetJSON []byte) (json.RawMessage, error) {
	workloads, err := apWorkloadsFromListJSON(deploymentJSON, statefulSetJSON)
	if err != nil {
		return nil, err
	}
	items := make([]interface{}, 0, len(workloads))
	for _, workload := range workloads {
		if apObject := workload.APObject(); apObject != nil {
			items = append(items, apObject)
		}
	}
	out := map[string]interface{}{
		"apiVersion": "brain.io/direct",
		"items":      items,
		"kind":       "APList",
	}
	return json.Marshal(out)
}

func apWorkloadsFromListJSON(deploymentJSON, statefulSetJSON []byte) ([]apWorkload, error) {
	workloads := []apWorkload{}
	if len(deploymentJSON) > 0 {
		var list unstructured.UnstructuredList
		if err := json.Unmarshal(deploymentJSON, &list); err != nil {
			return nil, err
		}
		for i := range list.Items {
			var deployment appsv1.Deployment
			if err := runtime.DefaultUnstructuredConverter.FromUnstructured(list.Items[i].Object, &deployment); err != nil {
				return nil, err
			}
			workloads = append(workloads, apWorkload{Deployment: &deployment})
		}
	}
	if len(statefulSetJSON) > 0 {
		var list unstructured.UnstructuredList
		if err := json.Unmarshal(statefulSetJSON, &list); err != nil {
			return nil, err
		}
		for i := range list.Items {
			var statefulSet appsv1.StatefulSet
			if err := runtime.DefaultUnstructuredConverter.FromUnstructured(list.Items[i].Object, &statefulSet); err != nil {
				return nil, err
			}
			workloads = append(workloads, apWorkload{StatefulSet: &statefulSet})
		}
	}
	return workloads, nil
}

func apResponseFromWorkloadListsWithPublicAccessSupport(cfg *clientcmdapi.Config, deploymentJSON, statefulSetJSON []byte) (json.RawMessage, error) {
	workloads, err := apWorkloadsFromListJSON(deploymentJSON, statefulSetJSON)
	if err != nil {
		return nil, err
	}
	support, err := newAPSupportResourceCache(cfg, workloads)
	if err != nil {
		return nil, err
	}
	items := make([]interface{}, 0, len(workloads))
	for _, workload := range workloads {
		item := workload.APObject()
		if item == nil {
			continue
		}
		ref := apWorkloadRefFromWorkload(workload)
		if ref.Name == "" || ref.Namespace == "" {
			items = append(items, item)
			continue
		}
		projected := aptransform.APWithPublicAccessSupportResourcesFromList(
			item,
			support.itemsFor(ref, "ingresses"),
			support.itemsFor(ref, "services"),
			support.itemsFor(ref, "certificates"),
			support.itemsFor(ref, "issuers"),
		)
		items = append(items, projected)
	}
	out := map[string]interface{}{
		"apiVersion": "brain.io/direct",
		"items":      items,
		"kind":       "APList",
	}
	return json.Marshal(out)
}

type apWorkloadRef struct {
	Name      string
	Namespace string
	ProjectID string
}

func apWorkloadRefFromWorkload(workload apWorkload) apWorkloadRef {
	return apWorkloadRef{
		Name:      workload.Name(),
		Namespace: workload.Namespace(),
		ProjectID: workloadProjectID(workload),
	}
}

type apSupportResourceCache struct {
	items map[string]map[string][]map[string]interface{}
}

func newAPSupportResourceCache(cfg *clientcmdapi.Config, workloads []apWorkload) (*apSupportResourceCache, error) {
	cache := &apSupportResourceCache{
		items: map[string]map[string][]map[string]interface{}{},
	}
	if len(workloads) == 0 {
		return cache, nil
	}
	seenScopes := map[string]bool{}
	for _, workload := range workloads {
		ref := apWorkloadRefFromWorkload(workload)
		if ref.Namespace == "" {
			continue
		}
		scope := ref.Namespace + "\x00" + ref.ProjectID
		if seenScopes[scope] {
			continue
		}
		seenScopes[scope] = true
		var mu sync.Mutex
		group := errgroup.Group{}
		for _, resource := range []string{"ingresses", "services", "certificates", "issuers"} {
			resource := resource
			group.Go(func() error {
				items, err := listAPPublicAccessSupportResourcesForScope(cfg, ref.Namespace, ref.ProjectID, resource)
				if err != nil {
					return err
				}
				mu.Lock()
				cache.items[scopeKey(ref.Namespace, ref.ProjectID, resource)] = groupAPPublicAccessSupportItems(items)
				mu.Unlock()
				return nil
			})
		}
		if err := group.Wait(); err != nil {
			return nil, err
		}
	}
	return cache, nil
}

func (cache *apSupportResourceCache) itemsFor(ref apWorkloadRef, resource string) []map[string]interface{} {
	if cache == nil || ref.Name == "" || ref.Namespace == "" {
		return nil
	}
	return cache.items[scopeKey(ref.Namespace, ref.ProjectID, resource)][ref.Name]
}

func scopeKey(namespace string, projectID string, resource string) string {
	return namespace + "\x00" + projectID + "\x00" + resource
}

func listAPPublicAccessSupportResourcesForScope(cfg *clientcmdapi.Config, namespace string, projectID string, resource string) ([]map[string]interface{}, error) {
	projectSelector := orchestration.BrainProjectIDLabel
	if trimmed := strings.TrimSpace(projectID); trimmed != "" {
		projectSelector += "=" + trimmed
	}
	jsonBytes, err := k8ssvc.Get(cfg, k8ssvc.GetOptions{
		LabelSelector: orchestration.LaunchpadAppDeployManagerLabel + "," +
			orchestration.BrainManagedByLabel + "=" + orchestration.BrainManagedByValue + "," +
			projectSelector,
		Namespace: namespace,
		Resource:  resource,
	})
	if apierrors.IsNotFound(err) || k8ssvc.IsUnknownResourceError(err, resource) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var list unstructured.UnstructuredList
	if err := json.Unmarshal(jsonBytes, &list); err != nil {
		return nil, err
	}
	items := make([]map[string]interface{}, 0, len(list.Items))
	for i := range list.Items {
		items = append(items, list.Items[i].Object)
	}
	return items, nil
}

func groupAPPublicAccessSupportItems(items []map[string]interface{}) map[string][]map[string]interface{} {
	out := map[string][]map[string]interface{}{}
	for _, item := range items {
		name := apSupportResourceAPName(item)
		if name == "" {
			continue
		}
		out[name] = append(out[name], item)
	}
	return out
}

func apSupportResourceAPName(item map[string]interface{}) string {
	metadata, _ := item["metadata"].(map[string]interface{})
	labels, _ := metadata["labels"].(map[string]interface{})
	if name := strings.TrimSpace(stringFromMap(labels, orchestration.LaunchpadAppDeployManagerLabel)); name != "" {
		return name
	}
	return strings.TrimSpace(stringFromMap(labels, orchestration.BrainDeploymentNameLabel))
}

func mergeK8sListJSON(left, right []byte) []byte {
	if len(left) == 0 {
		return right
	}
	if len(right) == 0 {
		return left
	}
	var leftList unstructured.UnstructuredList
	if err := json.Unmarshal(left, &leftList); err != nil {
		return left
	}
	var rightList unstructured.UnstructuredList
	if err := json.Unmarshal(right, &rightList); err != nil {
		return left
	}
	seen := map[string]bool{}
	for _, item := range leftList.Items {
		seen[item.GetNamespace()+"/"+item.GetName()] = true
	}
	for _, item := range rightList.Items {
		key := item.GetNamespace() + "/" + item.GetName()
		if seen[key] {
			continue
		}
		leftList.Items = append(leftList.Items, item)
	}
	outObject := leftList.Object
	if outObject == nil {
		outObject = map[string]interface{}{}
	}
	items := make([]interface{}, 0, len(leftList.Items))
	for i := range leftList.Items {
		items = append(items, leftList.Items[i].Object)
	}
	outObject["items"] = items
	out, err := json.Marshal(outObject)
	if err != nil {
		return left
	}
	return out
}

func requireBrainAPWorkload(workload apWorkload) error {
	if workload.Deployment != nil {
		return requireBrainAPDeployment(*workload.Deployment)
	}
	if workload.StatefulSet != nil {
		return requireBrainAPStatefulSet(*workload.StatefulSet)
	}
	return errors.New("AP workload is empty")
}

func isStrictBrainAPWorkload(workload apWorkload) bool {
	return requireBrainAPWorkload(workload) == nil
}

func requireBrainAPLikeWorkload(workload apWorkload) error {
	if workload.Deployment != nil {
		return requireLaunchpadAPDeployment(*workload.Deployment)
	}
	if workload.StatefulSet != nil {
		return requireLaunchpadAPStatefulSet(*workload.StatefulSet)
	}
	return errors.New("AP workload is empty")
}

func requireBrainAPLifecycleWorkload(workload apWorkload) error {
	return requireBrainAPLikeWorkload(workload)
}

func requireBrainAPStatefulSet(statefulSet appsv1.StatefulSet) error {
	return requireLaunchpadAPStatefulSet(statefulSet)
}

func requireLaunchpadAPStatefulSet(statefulSet appsv1.StatefulSet) error {
	labels := statefulSet.GetLabels()
	if strings.TrimSpace(labels[orchestration.LaunchpadAppDeployManagerLabel]) == "" {
		return errors.New("statefulset is not a Launchpad AP")
	}
	if labels[orchestration.BrainManagedByLabel] != orchestration.BrainManagedByValue ||
		strings.TrimSpace(labels[orchestration.BrainProjectIDLabel]) == "" {
		return errors.New("statefulset is not a Brain-owned Launchpad AP")
	}
	return nil
}

func requireBrainAPLikeStatefulSet(statefulSet appsv1.StatefulSet) error {
	return requireLaunchpadAPStatefulSet(statefulSet)
}
