package ap

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"strings"

	"github.com/danielgtaylor/huma/v2"
	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/kubernetes"

	"sealos/api/middleware"
	k8ssvc "sealos/api/service/k8s"
)

type apEnvSecretResolver interface {
	ResolveSecretKey(ctx context.Context, namespace string, name string, key string) (string, error)
}

type kubernetesAPEnvSecretResolver struct {
	client kubernetes.Interface
}

type resolveAPEnvSavedRowValueInput struct {
	Env            []corev1.EnvVar
	Name           string
	Namespace      string
	SecretResolver apEnvSecretResolver
}

var apEnvExpansionRE = regexp.MustCompile(`\$\(([A-Za-z_][A-Za-z0-9_.-]*)\)`)

func registerEnvValue(grp huma.API) {
	type envValueInput struct {
		middleware.AuthInput
		EnvName   string `query:"envName" required:"true" doc:"Saved AP environment variable name to resolve."`
		Name      string `query:"name" required:"true" doc:"AP instance name."`
		Namespace string `query:"namespace" doc:"Namespace (default from kubeconfig; admin can override)"`
	}
	type envValueOutput struct {
		CacheControl string `header:"Cache-Control"`
		Pragma       string `header:"Pragma"`
		Body         struct {
			Value string `json:"value"`
		}
	}

	huma.Register(grp, huma.Operation{
		OperationID: "ap-env-value",
		Method:      http.MethodGet,
		Path:        "/env-value",
		Summary:     "Resolve one saved AP environment value",
		Description: "Returns the fully resolved runtime value for one saved AP environment row. Responses are not cacheable and should only be used for explicit reveal or copy actions.",
		Tags:        []string{"AP"},
	}, func(ctx context.Context, input *envValueInput) (*envValueOutput, error) {
		restConfig, cfg, err := middleware.RestConfigFromAuth(input.Authorization)
		if err != nil {
			return nil, huma.Error400BadRequest("invalid kubeconfig", err)
		}
		if strings.TrimSpace(input.Name) == "" || strings.TrimSpace(input.EnvName) == "" {
			return nil, huma.Error400BadRequest("name and envName are required", nil)
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
			LabelSelector: apDeploymentLabelSelector(""),
			Resource:      "deployments",
			Name:          strings.TrimSpace(input.Name),
			Namespace:     resolved.Namespace,
		})
		if err != nil {
			if apierrors.IsNotFound(err) {
				return nil, huma.Error404NotFound("AP not found", err)
			}
			return nil, huma.Error500InternalServerError("failed to get AP", err)
		}
		var deployment appsv1.Deployment
		if err := json.Unmarshal(jsonBytes, &deployment); err != nil {
			return nil, huma.Error500InternalServerError("failed to parse AP", err)
		}
		if err := requireBrainAPDeployment(deployment); err != nil {
			return nil, huma.Error404NotFound("AP not found", err)
		}
		clientset, err := kubernetes.NewForConfig(restConfig)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to initialize Kubernetes client", err)
		}
		value, err := resolveAPEnvSavedRowValue(ctx, resolveAPEnvSavedRowValueInput{
			Env:            apDeploymentEnv(deployment),
			Name:           input.EnvName,
			Namespace:      deployment.Namespace,
			SecretResolver: kubernetesAPEnvSecretResolver{client: clientset},
		})
		if err != nil {
			return nil, apEnvValueError(err)
		}
		output := &envValueOutput{
			CacheControl: apEnvResolvedValueNoCacheHeader(),
			Pragma:       "no-cache",
		}
		output.Body.Value = value
		return output, nil
	})
}

func apEnvResolvedValueNoCacheHeader() string {
	return "no-cache, no-store, must-revalidate"
}

func apDeploymentEnv(deployment appsv1.Deployment) []corev1.EnvVar {
	if len(deployment.Spec.Template.Spec.Containers) == 0 {
		return nil
	}
	return deployment.Spec.Template.Spec.Containers[0].Env
}

func resolveAPEnvSavedRowValue(ctx context.Context, input resolveAPEnvSavedRowValueInput) (string, error) {
	name := strings.TrimSpace(input.Name)
	if name == "" {
		return "", huma.Error400BadRequest("envName is required", nil)
	}
	envByName := make(map[string]corev1.EnvVar, len(input.Env))
	for _, row := range input.Env {
		if row.Name != "" {
			envByName[row.Name] = row
		}
	}
	row, ok := envByName[name]
	if !ok {
		return "", apierrors.NewNotFound(schema.GroupResource{Resource: "environmentvariables"}, name)
	}
	return resolveAPEnvVarValue(ctx, row, input.Namespace, envByName, input.SecretResolver, map[string]bool{})
}

func resolveAPEnvVarValue(
	ctx context.Context,
	row corev1.EnvVar,
	namespace string,
	envByName map[string]corev1.EnvVar,
	secretResolver apEnvSecretResolver,
	seen map[string]bool,
) (string, error) {
	if seen[row.Name] {
		return "", fmt.Errorf("environment variable %q contains a circular reference", row.Name)
	}
	seen[row.Name] = true
	defer delete(seen, row.Name)

	value, err := directAPEnvVarValue(ctx, row, namespace, secretResolver)
	if err != nil {
		return "", err
	}
	var expansionErr error
	resolvedValue := apEnvExpansionRE.ReplaceAllStringFunc(value, func(token string) string {
		matches := apEnvExpansionRE.FindStringSubmatch(token)
		if len(matches) != 2 {
			return token
		}
		referenced, ok := envByName[matches[1]]
		if !ok {
			return token
		}
		resolved, err := resolveAPEnvVarValue(ctx, referenced, namespace, envByName, secretResolver, seen)
		if err != nil {
			if expansionErr == nil {
				expansionErr = err
			}
			return token
		}
		return resolved
	})
	if expansionErr != nil {
		return "", expansionErr
	}
	return resolvedValue, nil
}

func directAPEnvVarValue(ctx context.Context, row corev1.EnvVar, namespace string, secretResolver apEnvSecretResolver) (string, error) {
	if row.ValueFrom == nil {
		return row.Value, nil
	}
	secretRef := row.ValueFrom.SecretKeyRef
	if secretRef == nil {
		return "", nil
	}
	if secretResolver == nil {
		return "", fmt.Errorf("secret resolver is required")
	}
	return secretResolver.ResolveSecretKey(ctx, namespace, secretRef.Name, secretRef.Key)
}

func (resolver kubernetesAPEnvSecretResolver) ResolveSecretKey(ctx context.Context, namespace string, name string, key string) (string, error) {
	secret, err := resolver.client.CoreV1().Secrets(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return "", err
	}
	value, ok := secret.Data[key]
	if !ok {
		return "", fmt.Errorf("secret %s/%s key %q was not found", namespace, name, key)
	}
	return string(value), nil
}

func apEnvValueError(err error) error {
	if err == nil {
		return nil
	}
	if apierrors.IsNotFound(err) {
		return huma.Error404NotFound("environment variable not found", err)
	}
	if apierrors.IsForbidden(err) {
		return huma.Error403Forbidden("environment value cannot be resolved", err)
	}
	return huma.Error500InternalServerError("environment value cannot be resolved", err)
}
