package db

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"

	"github.com/danielgtaylor/huma/v2"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"

	"sealos/api/middleware"
	k8ssvc "sealos/api/service/k8s"
	orchestration "sealos/api/service/orchestration"
)

const dbConnectionStringCacheControl = "no-cache, no-store, must-revalidate"

// registerConnectionString serves the explicit reveal/copy path for DB
// Connection DSNs, modeled on the AP env-value route (ADR-0053): server-side
// composition, no-store response, reachable only through explicit user action.
// Default DB read responses carry credential-free DB Connection Templates.
func registerConnectionString(grp huma.API) {
	type connectionStringInput struct {
		middleware.AuthInput
		Kind      string `query:"kind" required:"true" enum:"private,public" doc:"Which DB Connection DSN to reveal: the in-cluster private address or the NodePort public address."`
		Name      string `query:"name" required:"true" doc:"DB instance name."`
		Namespace string `query:"namespace" doc:"Namespace (default from kubeconfig)"`
	}
	huma.Register(grp, huma.Operation{
		OperationID: "db-connection-string",
		Method:      http.MethodGet,
		Path:        "/connection-string",
		Summary:     "Reveal one DB Connection DSN",
		Description: "Returns the complete DB Connection DSN, including credentials, for one DB Service. Responses are not cacheable and should only be used for explicit reveal or copy actions; default DB read responses carry credential-free DB Connection Templates instead.",
		Tags:        []string{"DB"},
	}, func(ctx context.Context, input *connectionStringInput) (*connectionStringOutput, error) {
		_, cfg, err := middleware.RestConfigFromAuth(input.Authorization)
		if err != nil {
			return nil, huma.Error400BadRequest("invalid kubeconfig", err)
		}
		name := strings.TrimSpace(input.Name)
		if name == "" {
			return nil, huma.Error400BadRequest("name is required", nil)
		}
		resolved, err := middleware.ResolveContext(cfg, middleware.ResolveOptions{
			Namespace: input.Namespace, DefaultNamespace: ""})
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to resolve request context", err)
		}

		// Prefetch concurrently with the cluster read: both lookups depend
		// only on name and resolved.Namespace — the same namespace the
		// cluster read itself uses — and their results are consumed only
		// after the cluster passes validation below.
		secretCh := make(chan *unstructured.Unstructured, 1)
		go func() {
			secretCh <- dbConnectionSecret(cfg, name, resolved.Namespace)
		}()
		var exportCh chan exportServiceResult
		if input.Kind == "public" {
			exportCh = make(chan exportServiceResult, 1)
			go func() {
				body, err := k8ssvc.Get(cfg, k8ssvc.GetOptions{
					Name:      name + "-export",
					Namespace: resolved.Namespace,
					Resource:  "services",
				})
				exportCh <- exportServiceResult{body: body, err: err}
			}()
		}

		jsonBytes, err := k8ssvc.Get(cfg, k8ssvc.GetOptions{
			LabelSelector: dbClusterLabelSelector(""),
			Resource:      "clusters",
			Name:          name,
			Namespace:     resolved.Namespace,
		})
		if err != nil {
			if apierrors.IsNotFound(err) {
				return nil, huma.Error404NotFound("DB not found", err)
			}
			return nil, huma.Error500InternalServerError("failed to get DB", err)
		}
		var cluster unstructured.Unstructured
		if err := json.Unmarshal(jsonBytes, &cluster); err != nil {
			return nil, huma.Error500InternalServerError("failed to parse DB", err)
		}
		if err := requireBrainDBLikeCluster(cluster); err != nil {
			return nil, huma.Error404NotFound("DB not found", err)
		}
		namespace := cluster.GetNamespace()
		if namespace == "" {
			namespace = resolved.Namespace
		}
		value, err := dbRevealedConnectionString(
			orchestration.DBObjectFromCluster(&cluster),
			input.Kind, name, namespace,
			dbConnectionCredentialsFromSecret(<-secretCh),
			exportCh,
		)
		if err != nil {
			return nil, err
		}
		return connectionStringRevealOutput(value), nil
	})
}

type connectionStringOutput struct {
	CacheControl string `header:"Cache-Control"`
	Pragma       string `header:"Pragma"`
	Body         struct {
		Value string `json:"value"`
	}
}

// connectionStringRevealOutput assembles the reveal response: the composed DSN
// plus the no-store headers every reveal response must carry (ADR-0053).
func connectionStringRevealOutput(value string) *connectionStringOutput {
	output := &connectionStringOutput{
		CacheControl: dbConnectionStringCacheControl,
		Pragma:       "no-cache",
	}
	output.Body.Value = value
	return output
}

type exportServiceResult struct {
	body []byte
	err  error
}

// dbRevealedConnectionString composes the complete DB Connection DSN from the
// prefetched credential Secret (and, for kind=public, the prefetched export
// Service), reusing the same engine-profile composition the read paths used
// before they switched to templates.
func dbRevealedConnectionString(db map[string]interface{}, kind string, name string, namespace string, credentials dbConnectionCredentials, export <-chan exportServiceResult) (string, error) {
	switch kind {
	case "private":
		dsn := dbConnectionString(db, dbPrivateConnectionAddress(db, name, namespace), credentials)
		if dsn == "" {
			return "", huma.Error404NotFound("private connection string is not available", nil)
		}
		return dsn, nil
	case "public":
		if export == nil {
			return "", huma.Error500InternalServerError("export service was not prefetched", nil)
		}
		result := <-export
		if result.err != nil {
			if apierrors.IsNotFound(result.err) {
				return "", huma.Error404NotFound("public connection is not enabled", result.err)
			}
			return "", huma.Error500InternalServerError("failed to get DB public access service", result.err)
		}
		var service map[string]interface{}
		if err := json.Unmarshal(result.body, &service); err != nil {
			return "", huma.Error500InternalServerError("failed to parse DB public access service", err)
		}
		nodePort := firstServiceNodePort(service)
		if nodePort <= 0 {
			return "", huma.Error404NotFound("public connection is not enabled", nil)
		}
		dsn := dbConnectionString(db, dbPublicConnectionAddress(nodePort), credentials)
		if dsn == "" {
			return "", huma.Error404NotFound("public connection string is not available", nil)
		}
		return dsn, nil
	default:
		return "", huma.Error400BadRequest("kind must be private or public", nil)
	}
}
