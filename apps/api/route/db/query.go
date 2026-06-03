package db

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"

	"github.com/danielgtaylor/huma/v2"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"

	"sealos/api/middleware"
	k8ssvc "sealos/api/service/k8s"
	orchestration "sealos/api/service/orchestration"
)

func registerGet(grp huma.API) {
	type dbGetInput struct {
		middleware.AuthInput
		LabelSelector string `query:"label-selector" doc:"Optional Kubernetes label selector appended to the Brain-managed DB selector"`
		Name          string `query:"name" doc:"DB instance name (omit to list all in namespace)"`
		Namespace     string `query:"namespace" doc:"Namespace (default from kubeconfig; admin can override)"`
	}
	type dbGetOutput struct {
		Body json.RawMessage
	}

	huma.Register(grp, huma.Operation{
		OperationID: "db-get",
		Method:      http.MethodGet,
		Path:        "/",
		Summary:     "Get DB(s)",
		Description: "Get a single DB by name or list DBs in the namespace.\n\nParameter usage:\n- `name` is optional. If omitted, the endpoint lists all Brain-managed DBs in the resolved namespace.\n- `namespace` is optional. It uses the kubeconfig namespace by default; admins can override it.\n- `label-selector` is optional and is appended to the mandatory Brain DB selector.\n\nWhat the DB represents:\n- DB is a Brain product view backed by a KubeBlocks Cluster and related Kubernetes support resources.\n- `brain.io/project-id` is the project ownership boundary for list, canvas, and lifecycle operations.\n\nResponse:\n- Returns DB resource(s) with product-facing `spec` and `status.phase` adapted from the observed KubeBlocks Cluster.",
		Tags:        []string{"DB"},
	}, func(ctx context.Context, input *dbGetInput) (*dbGetOutput, error) {
		_, cfg, err := middleware.RestConfigFromAuth(input.Authorization)
		if err != nil {
			return nil, huma.Error400BadRequest("invalid kubeconfig", err)
		}

		gvr := middleware.PodsGVR()
		resolved, err := middleware.ResolveContext(cfg, middleware.ResolveOptions{
			Namespace:        input.Namespace,
			AllNamespaces:    false,
			DefaultNamespace: "",
			AdminCheckGVR:    &gvr,
		})
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to resolve request context", err)
		}

		jsonBytes, err := k8ssvc.Get(cfg, k8ssvc.GetOptions{
			LabelSelector: dbClusterLabelSelector(input.LabelSelector),
			Resource:      "clusters",
			Name:          input.Name,
			Namespace:     resolved.Namespace,
		})
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to get DB(s)", err)
		}
		body, err := dbResponseFromClusters(jsonBytes, input.Name != "")
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to adapt DB response", err)
		}
		return &dbGetOutput{Body: body}, nil
	})
}

func dbClusterLabelSelector(extra string) string {
	base := orchestration.BrainManagedByLabel + "=" + orchestration.BrainManagedByValue + "," + orchestration.BrainResourceKindLabel + "=" + orchestration.ResourceKindDB
	extra = strings.TrimSpace(extra)
	if extra == "" {
		return base
	}
	return base + "," + extra
}

func dbResponseFromClusters(jsonBytes []byte, single bool) (json.RawMessage, error) {
	if single {
		var cluster unstructured.Unstructured
		if err := json.Unmarshal(jsonBytes, &cluster); err != nil {
			return nil, err
		}
		return json.Marshal(orchestration.DBObjectFromCluster(&cluster))
	}
	var list unstructured.UnstructuredList
	if err := json.Unmarshal(jsonBytes, &list); err != nil {
		return nil, err
	}
	items := make([]interface{}, 0, len(list.Items))
	for i := range list.Items {
		items = append(items, orchestration.DBObjectFromCluster(&list.Items[i]))
	}
	out := map[string]interface{}{
		"apiVersion": "brain.io/direct",
		"items":      items,
		"kind":       "DBList",
	}
	return json.Marshal(out)
}
