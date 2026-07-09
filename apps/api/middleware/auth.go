package middleware

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"os"
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

// inClusterCAPath is where Kubernetes mounts the cluster CA bundle inside a pod — the same
// path rest.InClusterConfig trusts. It verifies the pinned apiserver's serving certificate.
const inClusterCAPath = "/var/run/secrets/kubernetes.io/serviceaccount/ca.crt"

// ErrNoTrustedAPIServer is returned when no platform-trusted apiserver can be resolved, so a
// caller's kubeconfig server cannot be safely overridden. User-credentialed requests then
// fail closed rather than trusting a client-supplied server.
var ErrNoTrustedAPIServer = errors.New(
	"no trusted Kubernetes API server configured: set K8S_API_URL or run in-cluster",
)

// trustedAPIServer resolves the apiserver the platform trusts, from operator-controlled
// configuration ONLY — an explicit K8S_API_URL, or the in-cluster
// KUBERNETES_SERVICE_HOST/KUBERNETES_SERVICE_PORT. It is deliberately never the
// client-supplied kubeconfig server.
//
// A caller authenticates by sending its own kubeconfig, and every namespace-scoped read is
// authorized by making the apiserver call *as the caller* and letting Kubernetes RBAC
// decide. If the server named in that kubeconfig were honored, a caller could point it at an
// apiserver it controls that returns fabricated 200s, satisfy the authorization gate for any
// namespace, and then have the real query run against a shared backend under the service's
// own access (VictoriaMetrics for telemetry, shared Postgres for AP versions, …). Pinning
// the server closes that bypass while the caller's bearer token / client certificate still
// supplies identity. Fails closed when no trusted server is configured.
func trustedAPIServer() (string, error) {
	if explicit := strings.TrimSpace(os.Getenv("K8S_API_URL")); explicit != "" {
		u, err := url.Parse(explicit)
		if err != nil || u.Host == "" {
			return "", fmt.Errorf("invalid K8S_API_URL %q", explicit)
		}
		if u.Scheme != "https" {
			return "", fmt.Errorf("K8S_API_URL must use https, got %q", explicit)
		}
		return strings.TrimRight(u.String(), "/"), nil
	}
	host := strings.TrimSpace(os.Getenv("KUBERNETES_SERVICE_HOST"))
	port := strings.TrimSpace(os.Getenv("KUBERNETES_SERVICE_PORT"))
	if host == "" || port == "" {
		return "", ErrNoTrustedAPIServer
	}
	return "https://" + net.JoinHostPort(host, port), nil
}

// trustedAPIServerCA resolves the CA bundle used to verify the pinned apiserver's serving
// certificate. Precedence: an explicit K8S_API_CA PEM, then the in-cluster CA file. When
// neither is present the process's default trust store is used and TLS verification stays
// on. The client kubeconfig's CA and insecure-skip-tls-verify are always ignored here, so a
// caller can neither redirect nor weaken the channel. At most one of (caData, caFile) is set.
func trustedAPIServerCA() (caData []byte, caFile string) {
	if pem := strings.TrimSpace(os.Getenv("K8S_API_CA")); pem != "" {
		return []byte(pem), ""
	}
	if _, err := os.Stat(inClusterCAPath); err == nil {
		return nil, inClusterCAPath
	}
	return nil, ""
}

// pinRestConfigToTrustedServer overwrites restConfig's server and TLS trust with the
// platform-trusted apiserver, preserving the caller's identity (bearer token or client
// certificate). It neutralizes any client-supplied server, CA, TLS server name, and
// insecure-skip-tls-verify. Fails closed if no trusted server is configured.
func pinRestConfigToTrustedServer(restConfig *rest.Config) error {
	if restConfig == nil {
		return nil
	}
	server, err := trustedAPIServer()
	if err != nil {
		return err
	}
	caData, caFile := trustedAPIServerCA()

	restConfig.Host = server
	// Trust is defined by the platform, never by the client kubeconfig.
	restConfig.TLSClientConfig.Insecure = false
	restConfig.TLSClientConfig.ServerName = ""
	restConfig.TLSClientConfig.CAData = caData
	restConfig.TLSClientConfig.CAFile = caFile
	return nil
}

// restConfigFromClientcmdConfig builds a rest.Config from a parsed kubeconfig and pins its
// server and TLS trust to the platform-trusted apiserver (never the client's) while keeping
// the caller's identity. Every user-credentialed apiserver access is built here, so the RBAC
// gate a request is authorized by is always evaluated by the real cluster.
func restConfigFromClientcmdConfig(cfg *clientcmdapi.Config) (*rest.Config, error) {
	restConfig, err := clientcmd.NewDefaultClientConfig(*cfg, &clientcmd.ConfigOverrides{}).ClientConfig()
	if err != nil {
		return nil, err
	}
	if err := pinRestConfigToTrustedServer(restConfig); err != nil {
		return nil, err
	}
	SuppressK8sRESTWarnings(restConfig)
	return restConfig, nil
}

type ResolveOptions struct {
	Namespace        string
	DefaultNamespace string
}

type ResolvedContext struct {
	RestConfig *rest.Config
	Namespace  string
	// Server is the hostname the caller *declared* in its kubeconfig, kept for
	// diagnostics only. It is not where requests go: RestConfig is pinned to the
	// platform-trusted apiserver (see restConfigFromClientcmdConfig / ADR 0046).
	Server string
}

// ResolveContext resolves rest config, effective namespace, and server.
func ResolveContext(cfg *clientcmdapi.Config, opts ResolveOptions) (*ResolvedContext, error) {
	restConfig, err := restConfigFromClientcmdConfig(cfg)
	if err != nil {
		return nil, err
	}

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
	restConfig, err := restConfigFromClientcmdConfig(cfg)
	if err != nil {
		return nil, nil, err
	}
	return restConfig, cfg, nil
}
