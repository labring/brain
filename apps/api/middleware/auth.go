package middleware

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"

	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
	clientcmdapi "k8s.io/client-go/tools/clientcmd/api"
)

// SuppressK8sRESTWarnings discards Kubernetes API Warning headers for this client.
// The apiserver emits notices (for example about legacy service account secret tokens)
// as Warning headers; the default client-go handler logs each one via klog.
func SuppressK8sRESTWarnings(c *rest.Config) {
	if c == nil {
		return
	}
	c.WarningHandlerWithContext = rest.NoWarnings{}
}

// ErrMissingAuth is returned when Authorization header is missing.
var ErrMissingAuth = errors.New("missing Authorization header")

// AuthInput is embedded in Huma operations that need kubeconfig auth.
type AuthInput struct {
	Authorization string `header:"Authorization" required:"true" doc:"Bearer token with url-encoded kubeconfig"`
}

type contextKey string

const authHeaderKey contextKey = "auth"

// Auth wraps the next handler and extracts the Authorization header into the request context.
func Auth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		auth := r.Header.Get("Authorization")
		ctx := context.WithValue(r.Context(), authHeaderKey, auth)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// AuthHeader returns the Authorization header value from the request context.
func AuthHeader(r *http.Request) string {
	if v := r.Context().Value(authHeaderKey); v != nil {
		return v.(string)
	}
	return ""
}

// ConfigFromAuth parses Authorization header (Bearer <url-encoded-kubeconfig>) and returns clientcmdapi.Config.
func ConfigFromAuth(auth string) (*clientcmdapi.Config, error) {
	auth = strings.TrimPrefix(auth, "Bearer ")
	if auth == "" {
		return nil, ErrMissingAuth
	}
	kubeconfig, err := url.QueryUnescape(auth)
	if err != nil {
		return nil, fmt.Errorf("invalid kubeconfig encoding")
	}
	return clientcmd.Load([]byte(kubeconfig))
}

type ResolveOptions struct {
	Namespace        string
	DefaultNamespace string
}

type ResolvedContext struct {
	RestConfig *rest.Config
	Namespace  string
	Server     string
}

// ResolveContext resolves rest config, effective namespace, and server.
func ResolveContext(cfg *clientcmdapi.Config, opts ResolveOptions) (*ResolvedContext, error) {
	restConfig, err := clientcmd.NewDefaultClientConfig(*cfg, &clientcmd.ConfigOverrides{}).ClientConfig()
	if err != nil {
		return nil, err
	}
	SuppressK8sRESTWarnings(restConfig)

	userNS := ""
	server := ""
	if cfg != nil && cfg.CurrentContext != "" {
		if ctx := cfg.Contexts[cfg.CurrentContext]; ctx != nil {
			userNS = ctx.Namespace
			if c := cfg.Clusters[ctx.Cluster]; c != nil && c.Server != "" {
				if u, parseErr := url.Parse(c.Server); parseErr == nil {
					server = u.Hostname()
				}
			}
		}
	}

	ns := ""
	if opts.Namespace != "" {
		ns = opts.Namespace
	} else if userNS != "" {
		ns = userNS
	} else {
		ns = opts.DefaultNamespace
	}

	return &ResolvedContext{RestConfig: restConfig, Namespace: ns, Server: server}, nil
}

// RestConfigFromAuth parses Authorization header and returns rest.Config and clientcmd Config.
func RestConfigFromAuth(auth string) (*rest.Config, *clientcmdapi.Config, error) {
	cfg, err := ConfigFromAuth(auth)
	if err != nil {
		return nil, nil, err
	}
	restConfig, err := clientcmd.NewDefaultClientConfig(*cfg, &clientcmd.ConfigOverrides{}).ClientConfig()
	if err != nil {
		return nil, nil, err
	}
	SuppressK8sRESTWarnings(restConfig)
	return restConfig, cfg, nil
}
