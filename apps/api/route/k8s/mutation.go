package k8s

import (
	"context"
	"encoding/json"
	"net/http"

	"github.com/danielgtaylor/huma/v2"

	"sealos/api/middleware"
	k8ssvc "sealos/api/service/k8s"
)

func registerApply(grp huma.API) {
	type applyBody struct {
		YAML string `json:"yaml" doc:"YAML manifest(s) to apply"`
	}
	type applyInput struct {
		middleware.AuthInput
		Body applyBody
	}
	huma.Register(grp, huma.Operation{
		OperationID: "k8s-apply",
		Method:      http.MethodPost,
		Path:        "/apply",
		Summary:     "Apply manifest",
		Description: "Apply Kubernetes YAML manifest(s). Send JSON body with yaml field.",
		Tags:        []string{"K8s"},
	}, func(ctx context.Context, input *applyInput) (*struct{}, error) {
		restConfig, cfg, err := middleware.RestConfigFromAuth(input.Authorization)
		if err != nil {
			return nil, huma.Error400BadRequest("invalid kubeconfig", err)
		}
		if input.Body.YAML == "" {
			return nil, huma.Error400BadRequest("body.yaml is required", nil)
		}
		gvr := middleware.PodsGVR()
		resolved, err := middleware.ResolveContext(cfg, middleware.ResolveOptions{
			Namespace:        "",
			AllNamespaces:    false,
			DefaultNamespace: "default",
			AdminCheckGVR:    &gvr,
		})
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to resolve namespace from kubeconfig", err)
		}
		implicitNS := resolved.Namespace
		if implicitNS == "" {
			implicitNS = "default"
		}
		if err := k8ssvc.ApplyYAML(restConfig, []byte(input.Body.YAML), implicitNS); err != nil {
			return nil, huma.Error500InternalServerError("failed to apply", err)
		}
		return nil, nil
	})
}

func registerDelete(grp huma.API) {
	type deleteInput struct {
		middleware.AuthInput
		Kind          string `query:"kind" required:"true" doc:"Resource kind"`
		Name          string `query:"name" doc:"Resource name"`
		Namespace     string `query:"namespace" doc:"Namespace"`
		LabelSelector string `query:"label-selector" doc:"Label selector"`
		FieldSelector string `query:"field-selector" doc:"Field selector"`
		All           string `query:"all" doc:"Delete all matching (true/1)"`
	}
	type deleteOutput struct {
		Body json.RawMessage
	}
	handler := func(ctx context.Context, input *deleteInput) (*deleteOutput, error) {
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
		opts := k8ssvc.DeleteOptions{
			Resource:      input.Kind,
			Name:          input.Name,
			Namespace:     resolved.Namespace,
			LabelSelector: input.LabelSelector,
			FieldSelector: input.FieldSelector,
			All:           input.All == "true" || input.All == "1",
		}
		jsonBytes, err := k8ssvc.Delete(cfg, opts)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to delete", err)
		}
		return &deleteOutput{Body: json.RawMessage(jsonBytes)}, nil
	}
	huma.Register(grp, huma.Operation{
		OperationID: "k8s-delete",
		Method:      http.MethodDelete,
		Path:        "/delete",
		Summary:     "Delete resources",
		Description: "Delete Kubernetes resources. Supports both DELETE and POST methods.",
		Tags:        []string{"K8s"},
	}, handler)
	huma.Register(grp, huma.Operation{
		OperationID: "k8s-delete-post", Method: http.MethodPost, Path: "/delete",
		Summary: "Delete (POST)", Tags: []string{"K8s"}, Hidden: true,
	}, handler)
}

func registerPatch(grp huma.API) {
	type patchInput struct {
		middleware.AuthInput
		Kind      string          `query:"kind" required:"true" doc:"Resource kind"`
		Name      string          `query:"name" required:"true" doc:"Resource name"`
		Namespace string          `query:"namespace" doc:"Namespace"`
		Type      string          `query:"type" doc:"Patch type: strategic, merge, json"`
		Body      json.RawMessage `contentType:"application/json" doc:"Patch body (JSON merge/strategic patch)"`
	}
	type patchOutput struct {
		Body json.RawMessage
	}
	handler := func(ctx context.Context, input *patchInput) (*patchOutput, error) {
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
		opts := k8ssvc.PatchOptions{
			Resource:  input.Kind,
			Name:      input.Name,
			Namespace: resolved.Namespace,
			PatchType: k8ssvc.PatchType(input.Type),
			Patch:     input.Body,
		}
		jsonBytes, err := k8ssvc.Patch(cfg, opts)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to patch", err)
		}
		return &patchOutput{Body: json.RawMessage(jsonBytes)}, nil
	}
	huma.Register(grp, huma.Operation{
		OperationID: "k8s-patch",
		Method:      http.MethodPatch,
		Path:        "/patch",
		Summary:     "Patch resource",
		Description: "Patch a Kubernetes resource. Supports PATCH and POST methods.",
		Tags:        []string{"K8s"},
	}, handler)
	huma.Register(grp, huma.Operation{
		OperationID: "k8s-patch-post", Method: http.MethodPost, Path: "/patch",
		Summary: "Patch (POST)", Tags: []string{"K8s"}, Hidden: true,
	}, handler)
}

func registerScale(grp huma.API) {
	type scaleInput struct {
		middleware.AuthInput
		Kind            string `query:"kind" required:"true" doc:"Resource kind (deploy, rs, sts)"`
		Name            string `query:"name" required:"true" doc:"Resource name"`
		Namespace       string `query:"namespace" doc:"Namespace"`
		Replicas        int32  `query:"replicas" required:"true" doc:"Desired replica count"`
		CurrentReplicas int32  `query:"current-replicas" doc:"Current replicas (for conflict check)"`
	}
	type scaleOutput struct {
		Body json.RawMessage
	}
	handler := func(ctx context.Context, input *scaleInput) (*scaleOutput, error) {
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
		opts := k8ssvc.ScaleOptions{
			Resource:        input.Kind,
			Name:            input.Name,
			Namespace:       resolved.Namespace,
			Replicas:        input.Replicas,
			CurrentReplicas: input.CurrentReplicas,
		}
		if opts.Replicas < 0 {
			return nil, huma.Error400BadRequest("replicas must be >= 0", nil)
		}
		jsonBytes, err := k8ssvc.Scale(cfg, opts)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to scale", err)
		}
		return &scaleOutput{Body: json.RawMessage(jsonBytes)}, nil
	}
	huma.Register(grp, huma.Operation{
		OperationID: "k8s-scale",
		Method:      http.MethodPut,
		Path:        "/scale",
		Summary:     "Scale resource",
		Description: "Scale deployment, replicaset, or statefulset. Supports PUT and POST.",
		Tags:        []string{"K8s"},
	}, handler)
	huma.Register(grp, huma.Operation{
		OperationID: "k8s-scale-post", Method: http.MethodPost, Path: "/scale",
		Summary: "Scale (POST)", Tags: []string{"K8s"}, Hidden: true,
	}, handler)
}

func registerAutoscale(grp huma.API) {
	type autoscaleInput struct {
		middleware.AuthInput
		Kind       string `query:"kind" required:"true" doc:"Resource kind (deploy, rs, sts)"`
		Name       string `query:"name" required:"true" doc:"Resource name"`
		Namespace  string `query:"namespace" doc:"Namespace"`
		Min        int32  `query:"min" doc:"Min replicas"`
		Max        int32  `query:"max" required:"true" doc:"Max replicas"`
		CPUPercent int32  `query:"cpu-percent" doc:"Target CPU % (default 80)"`
	}
	type autoscaleOutput struct {
		Body json.RawMessage
	}
	handler := func(ctx context.Context, input *autoscaleInput) (*autoscaleOutput, error) {
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
		cpu := input.CPUPercent
		if cpu == 0 {
			cpu = 80
		}
		opts := k8ssvc.AutoscaleOptions{
			Resource:    input.Kind,
			Name:        input.Name,
			Namespace:   resolved.Namespace,
			MinReplicas: input.Min,
			MaxReplicas: input.Max,
			CPUPercent:  cpu,
		}
		jsonBytes, err := k8ssvc.Autoscale(cfg, opts)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to autoscale", err)
		}
		return &autoscaleOutput{Body: json.RawMessage(jsonBytes)}, nil
	}
	huma.Register(grp, huma.Operation{
		OperationID: "k8s-autoscale",
		Method:      http.MethodPut,
		Path:        "/autoscale",
		Summary:     "Create/update HPA",
		Description: "Create or update HorizontalPodAutoscaler. Supports PUT and POST.",
		Tags:        []string{"K8s"},
	}, handler)
	huma.Register(grp, huma.Operation{
		OperationID: "k8s-autoscale-post", Method: http.MethodPost, Path: "/autoscale",
		Summary: "Autoscale (POST)", Tags: []string{"K8s"}, Hidden: true,
	}, handler)
}

func registerRollout(grp huma.API) {
	type rolloutInput struct {
		middleware.AuthInput
		Kind      string `query:"kind" required:"true" doc:"Resource kind (deploy, sts)"`
		Name      string `query:"name" required:"true" doc:"Resource name"`
		Namespace string `query:"namespace" doc:"Namespace"`
		Action    string `query:"action" doc:"restart or status (default: restart)"`
	}
	type rolloutOutput struct {
		Body json.RawMessage
	}
	handler := func(ctx context.Context, input *rolloutInput) (*rolloutOutput, error) {
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
		action := input.Action
		if action == "" {
			action = "restart"
		}
		if action != "restart" && action != "status" {
			return nil, huma.Error400BadRequest("action must be restart or status", nil)
		}
		ns := resolved.Namespace
		opts := k8ssvc.RolloutOptions{
			Resource: input.Kind, Name: input.Name, Namespace: ns,
		}
		var jsonBytes []byte
		if action == "restart" {
			jsonBytes, err = k8ssvc.RolloutRestart(cfg, opts)
		} else {
			jsonBytes, err = k8ssvc.RolloutStatus(cfg, k8ssvc.RolloutStatusOptions{
				Resource: opts.Resource, Name: opts.Name, Namespace: ns,
			})
		}
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to rollout "+action, err)
		}
		return &rolloutOutput{Body: json.RawMessage(jsonBytes)}, nil
	}
	huma.Register(grp, huma.Operation{
		OperationID: "k8s-rollout",
		Method:      http.MethodPost,
		Path:        "/rollout",
		Summary:     "Rollout restart/status",
		Description: "Restart rollout or get rollout status. Action: restart (default) or status.",
		Tags:        []string{"K8s"},
	}, handler)
	huma.Register(grp, huma.Operation{
		OperationID: "k8s-rollout-get", Method: http.MethodGet, Path: "/rollout",
		Summary: "Rollout status (GET)", Tags: []string{"K8s"}, Hidden: true,
	}, handler)
}
