package k8s

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"github.com/danielgtaylor/huma/v2"
	corev1 "k8s.io/api/core/v1"

	"sealos/api/middleware"
	k8ssvc "sealos/api/service/k8s"
)

func registerGet(grp huma.API) {
	type getInput struct {
		Authorization string `header:"Authorization" doc:"Bearer url-encoded kubeconfig"`
		Kind          string `query:"kind" required:"true" doc:"Resource kind (e.g. pods, deploy)"`
		Name          string `query:"name" doc:"Resource name"`
		Namespace     string `query:"namespace" doc:"Namespace (default from kubeconfig)"`
		LabelSelector string `query:"label-selector" doc:"Label selector"`
		FieldSelector string `query:"field-selector" doc:"Field selector"`
	}
	type getOutput struct {
		Body json.RawMessage
	}
	handler := func(ctx context.Context, input *getInput) (*getOutput, error) {
		authz := strings.TrimSpace(input.Authorization)
		opts := k8ssvc.GetOptions{
			Resource:      input.Kind,
			Name:          input.Name,
			Namespace:     input.Namespace,
			LabelSelector: input.LabelSelector,
			FieldSelector: input.FieldSelector,
		}

		if authz == "" {
			return nil, huma.Error400BadRequest("Authorization is required", nil)
		}
		_, cfg, err := middleware.RestConfigFromAuth(authz)
		if err != nil {
			return nil, huma.Error400BadRequest("invalid kubeconfig", err)
		}
		resolved, err := middleware.ResolveContext(cfg, middleware.ResolveOptions{
			Namespace:        input.Namespace,
			DefaultNamespace: corev1.NamespaceDefault,
		})
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to resolve request context", err)
		}
		opts.Namespace = resolved.Namespace

		jsonBytes, err := k8ssvc.Get(cfg, opts)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to get resource", err)
		}
		return &getOutput{Body: json.RawMessage(jsonBytes)}, nil
	}
	huma.Register(grp, huma.Operation{
		OperationID: "k8s-get",
		Method:      http.MethodGet,
		Path:        "/get",
		Summary:     "Get resources",
		Description: "Get or list Kubernetes resources. Use kind (e.g. pods, deploy) and optionally name.",
		Tags:        []string{"K8s"},
	}, handler)
	huma.Register(grp, huma.Operation{
		OperationID: "k8s-get-root", Method: http.MethodGet, Path: "/",
		Summary: "Get resources (alias)", Tags: []string{"K8s"}, Hidden: true,
	}, handler)
}

func registerDescribe(grp huma.API) {
	type describeInput struct {
		middleware.AuthInput
		Kind          string `query:"kind" required:"true" doc:"Resource kind"`
		Name          string `query:"name" doc:"Resource name"`
		Namespace     string `query:"namespace" doc:"Namespace"`
		LabelSelector string `query:"label-selector" doc:"Label selector"`
		FieldSelector string `query:"field-selector" doc:"Field selector"`
	}
	type describeOutput struct {
		Body json.RawMessage
	}
	huma.Register(grp, huma.Operation{
		OperationID: "k8s-describe",
		Method:      http.MethodGet,
		Path:        "/describe",
		Summary:     "Describe resource",
		Description: "Describe Kubernetes resources (events, conditions, etc.).",
		Tags:        []string{"K8s"},
	}, func(ctx context.Context, input *describeInput) (*describeOutput, error) {
		_, cfg, err := middleware.RestConfigFromAuth(input.Authorization)
		if err != nil {
			return nil, huma.Error400BadRequest("invalid kubeconfig", err)
		}
		resolved, err := middleware.ResolveContext(cfg, middleware.ResolveOptions{
			Namespace:        input.Namespace,
			DefaultNamespace: corev1.NamespaceDefault,
		})
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to resolve request context", err)
		}
		opts := k8ssvc.DescribeOptions{
			Resource:      input.Kind,
			Name:          input.Name,
			Namespace:     resolved.Namespace,
			LabelSelector: input.LabelSelector,
			FieldSelector: input.FieldSelector,
		}
		jsonBytes, err := k8ssvc.Describe(cfg, opts)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to describe", err)
		}
		return &describeOutput{Body: json.RawMessage(jsonBytes)}, nil
	})
}

func registerLogs(grp huma.API) {
	type logsInput struct {
		middleware.AuthInput
		Pod        string `query:"pod" required:"true" doc:"Pod name"`
		Namespace  string `query:"namespace" doc:"Namespace"`
		Container  string `query:"container" doc:"Container name"`
		Tail       string `query:"tail" doc:"Lines to show from end"`
		Since      string `query:"since" doc:"Show logs since (seconds)"`
		Timestamps string `query:"timestamps" doc:"Add timestamps (true)"`
		Previous   string `query:"previous" doc:"Previous container logs (true)"`
	}
	type logsOutput struct {
		Body string `contentType:"text/plain"`
	}
	huma.Register(grp, huma.Operation{
		OperationID: "k8s-logs",
		Method:      http.MethodGet,
		Path:        "/logs",
		Summary:     "Get pod logs",
		Description: "Stream logs from a pod.",
		Tags:        []string{"K8s"},
	}, func(ctx context.Context, input *logsInput) (*logsOutput, error) {
		_, cfg, err := middleware.RestConfigFromAuth(input.Authorization)
		if err != nil {
			return nil, huma.Error400BadRequest("invalid kubeconfig", err)
		}
		resolved, err := middleware.ResolveContext(cfg, middleware.ResolveOptions{
			Namespace:        input.Namespace,
			DefaultNamespace: corev1.NamespaceDefault,
		})
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to resolve request context", err)
		}
		tail, _ := strconv.ParseInt(input.Tail, 10, 64)
		since, _ := strconv.ParseInt(input.Since, 10, 64)
		opts := k8ssvc.LogsOptions{
			Pod:          input.Pod,
			Namespace:    resolved.Namespace,
			Container:    input.Container,
			TailLines:    tail,
			SinceSeconds: since,
			Timestamps:   input.Timestamps == "true",
			Previous:     input.Previous == "true",
		}
		logBytes, err := k8ssvc.LogsBytes(cfg, opts)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to get logs", err)
		}
		return &logsOutput{Body: string(logBytes)}, nil
	})
}

func registerTop(grp huma.API) {
	type topInput struct {
		middleware.AuthInput
		Kind       string `query:"kind" doc:"Resource kind (pods only)"`
		Name       string `query:"name" doc:"Resource name"`
		Namespace  string `query:"namespace" doc:"Namespace"`
		Containers string `query:"containers" doc:"Show containers (true)"`
	}
	type topOutput struct {
		Body json.RawMessage
	}
	huma.Register(grp, huma.Operation{
		OperationID: "k8s-top",
		Method:      http.MethodGet,
		Path:        "/top",
		Summary:     "Resource usage",
		Description: "Get pod CPU/memory usage in the resolved namespace. Requires metrics-server.",
		Tags:        []string{"K8s"},
	}, func(ctx context.Context, input *topInput) (*topOutput, error) {
		_, cfg, err := middleware.RestConfigFromAuth(input.Authorization)
		if err != nil {
			return nil, huma.Error400BadRequest("invalid kubeconfig", err)
		}
		resolved, err := middleware.ResolveContext(cfg, middleware.ResolveOptions{
			Namespace:        input.Namespace,
			DefaultNamespace: corev1.NamespaceDefault,
		})
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to resolve request context", err)
		}
		opts := k8ssvc.TopOptions{
			Resource:   input.Kind,
			Name:       input.Name,
			Namespace:  resolved.Namespace,
			Containers: input.Containers == "true",
		}
		if opts.Resource == "" {
			opts.Resource = "pods"
		}
		jsonBytes, err := k8ssvc.Top(cfg, opts)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to get top", err)
		}
		return &topOutput{Body: json.RawMessage(jsonBytes)}, nil
	})
}
