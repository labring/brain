package ap

import (
	"context"
	"encoding/json"
	"errors"
	"strings"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	clientcmdapi "k8s.io/client-go/tools/clientcmd/api"

	k8ssvc "sealos/api/service/k8s"
	orchestration "sealos/api/service/orchestration"
)

func currentAPConfigMapMounts(cfg *clientcmdapi.Config, workload apWorkload) ([]orchestration.APConfigMapMount, error) {
	apObject := workload.APObject()
	spec, _ := apObject["spec"].(map[string]interface{})
	input, _ := spec["input"].(map[string]interface{})
	rows, _ := input["configMaps"].([]interface{})
	if len(rows) == 0 {
		return nil, nil
	}
	configMapsByName := map[string]corev1.ConfigMap{}
	out := make([]orchestration.APConfigMapMount, 0, len(rows))
	for _, row := range rows {
		item, _ := row.(map[string]interface{})
		if item == nil {
			continue
		}
		path := stringFromMap(item, "path")
		key := stringFromMap(item, "key")
		if path == "" || key == "" {
			continue
		}
		configMapName := stringFromMap(item, "name")
		if configMapName == "" {
			configMapName = orchestration.APConfigMapName(workload.Name())
		}
		configMap, ok := configMapsByName[configMapName]
		if !ok {
			configMapJSON, err := k8ssvc.Get(cfg, k8ssvc.GetOptions{
				Resource:  "configmaps",
				Name:      configMapName,
				Namespace: workload.Namespace(),
			})
			if apierrors.IsNotFound(err) {
				continue
			}
			if err != nil {
				return nil, err
			}
			if err := json.Unmarshal(configMapJSON, &configMap); err != nil {
				return nil, err
			}
			configMapsByName[configMapName] = configMap
		}
		out = append(out, orchestration.APConfigMapMount{
			Path:  path,
			Value: configMap.Data[key],
		})
	}
	return out, nil
}

func apStorageInputFromStatefulSet(statefulSet *appsv1.StatefulSet) []orchestration.APStorageMount {
	if statefulSet == nil {
		return nil
	}
	out := make([]orchestration.APStorageMount, 0, len(statefulSet.Spec.VolumeClaimTemplates))
	for _, claim := range statefulSet.Spec.VolumeClaimTemplates {
		path := strings.TrimSpace(claim.Annotations[orchestration.APStorageMountPathAnnotation])
		if path == "" {
			path = strings.TrimSpace(claim.Annotations["path"])
		}
		if path == "" {
			continue
		}
		size := strings.TrimSpace(claim.Annotations[orchestration.APStorageSizeAnnotation])
		if size == "" {
			size = claim.Spec.Resources.Requests.Storage().String()
		}
		out = append(out, orchestration.APStorageMount{Path: path, Size: size})
	}
	return out
}

func apDesiredStorageInputFromAnnotations(annotations map[string]string) []orchestration.APStorageMount {
	raw := strings.TrimSpace(annotations[orchestration.APDesiredStorageAnnotation])
	if raw == "" {
		return nil
	}
	var out []orchestration.APStorageMount
	if err := json.Unmarshal([]byte(raw), &out); err != nil {
		return nil
	}
	filtered := make([]orchestration.APStorageMount, 0, len(out))
	for _, item := range out {
		path := strings.TrimSpace(item.Path)
		if path == "" {
			continue
		}
		filtered = append(filtered, orchestration.APStorageMount{
			Path: path,
			Size: strings.TrimSpace(item.Size),
		})
	}
	return filtered
}

func validateAPStoragePatch(current apWorkload, existing, next []orchestration.APStorageMount) error {
	if current.Deployment != nil && len(next) > 0 {
		return errors.New("adding storage to an existing Deployment AP is not supported; create a StatefulSet-backed AP")
	}
	if current.StatefulSet == nil {
		return nil
	}
	if len(existing) != len(next) {
		return errors.New("StatefulSet AP storage paths cannot be added or removed in this version")
	}
	existingByPath := map[string]string{}
	for _, item := range existing {
		existingByPath[item.Path] = item.Size
	}
	for _, item := range next {
		currentSize, ok := existingByPath[item.Path]
		if !ok {
			return errors.New("StatefulSet AP storage paths cannot be changed in this version")
		}
		currentQuantity, err := resource.ParseQuantity(currentSize)
		if err != nil {
			return err
		}
		nextQuantity, err := resource.ParseQuantity(item.Size)
		if err != nil {
			return err
		}
		if nextQuantity.Cmp(currentQuantity) < 0 {
			return errors.New("PVC storage cannot be shrunk")
		}
	}
	return nil
}

func storageForStatefulSetTemplate(existing, next []orchestration.APStorageMount) []orchestration.APStorageMount {
	if len(existing) == 0 {
		return next
	}
	out := make([]orchestration.APStorageMount, 0, len(existing))
	for _, item := range existing {
		out = append(out, item)
	}
	return out
}

func patchAPStatefulSetPVCStorage(ctx context.Context, restConfig *rest.Config, workload apWorkload, desired []orchestration.APStorageMount) error {
	if workload.StatefulSet == nil || len(desired) == 0 {
		return nil
	}
	clientset, err := kubernetes.NewForConfig(restConfig)
	if err != nil {
		return err
	}
	var pvcs corev1.PersistentVolumeClaimList
	for _, selector := range apLikeWorkloadLabelSelectors(orchestration.BrainDeploymentNameLabel + "=" + workload.Name()) {
		next, err := clientset.CoreV1().PersistentVolumeClaims(workload.Namespace()).List(ctx, metav1.ListOptions{
			LabelSelector: selector,
		})
		if err != nil {
			return err
		}
		pvcs.Items = append(pvcs.Items, next.Items...)
	}
	desiredByPath := map[string]orchestration.APStorageMount{}
	for _, item := range desired {
		desiredByPath[item.Path] = item
	}
	for i := range pvcs.Items {
		pvc := &pvcs.Items[i]
		path := strings.TrimSpace(pvc.Annotations[orchestration.APStorageMountPathAnnotation])
		if path == "" {
			path = strings.TrimSpace(pvc.Annotations["path"])
		}
		desiredMount, ok := desiredByPath[path]
		if !ok {
			continue
		}
		nextQuantity, err := resource.ParseQuantity(desiredMount.Size)
		if err != nil {
			return err
		}
		currentQuantity := pvc.Spec.Resources.Requests[corev1.ResourceStorage]
		if !currentQuantity.IsZero() && nextQuantity.Cmp(currentQuantity) < 0 {
			return errors.New("PVC storage cannot be shrunk")
		}
		if !currentQuantity.IsZero() && nextQuantity.Cmp(currentQuantity) <= 0 &&
			strings.TrimSpace(pvc.Annotations[orchestration.APStorageSizeAnnotation]) == desiredMount.Size {
			continue
		}
		patch, err := json.Marshal(map[string]interface{}{
			"metadata": map[string]interface{}{
				"annotations": map[string]string{
					orchestration.APStorageSizeAnnotation: desiredMount.Size,
				},
			},
			"spec": map[string]interface{}{
				"resources": map[string]interface{}{
					"requests": map[string]string{
						string(corev1.ResourceStorage): desiredMount.Size,
					},
				},
			},
		})
		if err != nil {
			return err
		}
		if _, err := clientset.CoreV1().PersistentVolumeClaims(workload.Namespace()).Patch(ctx, pvc.Name, types.MergePatchType, patch, metav1.PatchOptions{}); err != nil {
			return err
		}
	}
	return nil
}
