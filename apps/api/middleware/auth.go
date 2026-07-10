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

type trustedAPIServerTransport struct {
	server string
	caData []byte
	caFile string
}

// resolveTrustedAPIServerTransport resolves the apiserver and CA the platform trusts from
// operator-controlled configuration ONLY. In-cluster coordinates and their mounted CA take
// precedence so deployed Pods stay on the internal control-plane path; K8S_API_URL and
// K8S_API_CA are the off-cluster development fallback. If the in-cluster CA is not mounted,
// K8S_API_CA may supply that same cluster CA without restoring a service-account token. The
// server and CA are deliberately never taken from the client-supplied kubeconfig.
//
// A caller authenticates by sending its own kubeconfig, and every namespace-scoped read is
// authorized by making the apiserver call *as the caller* and letting Kubernetes RBAC
// decide. If the server named in that kubeconfig were honored, a caller could point it at an
// apiserver it controls that returns fabricated 200s, satisfy the authorization gate for any
// namespace, and then have the real query run against a shared backend under the service's
// own access (VictoriaMetrics for telemetry, shared Postgres for AP versions, …). Pinning
// the server closes that bypass while the active user's inline bearer token supplies identity.
// Fails closed when no trusted server is configured.
func resolveTrustedAPIServerTransport(inClusterCAFile string) (*trustedAPIServerTransport, error) {
	host := strings.TrimSpace(os.Getenv("KUBERNETES_SERVICE_HOST"))
	port := strings.TrimSpace(os.Getenv("KUBERNETES_SERVICE_PORT"))
	explicitCA := strings.TrimSpace(os.Getenv("K8S_API_CA"))
	if (host == "") != (port == "") {
		return nil, fmt.Errorf(
			"in-cluster Kubernetes API server configuration is incomplete: KUBERNETES_SERVICE_HOST and KUBERNETES_SERVICE_PORT must both be set",
		)
	}
	if host != "" && port != "" {
		transport := &trustedAPIServerTransport{
			server: "https://" + net.JoinHostPort(host, port),
		}
		if inClusterCAFile != "" {
			if _, err := os.Stat(inClusterCAFile); err == nil {
				transport.caFile = inClusterCAFile
				return transport, nil
			}
		}
		if explicitCA != "" {
			transport.caData = []byte(explicitCA)
		}
		return transport, nil
	}
	if explicit := strings.TrimSpace(os.Getenv("K8S_API_URL")); explicit != "" {
		u, err := url.Parse(explicit)
		if err != nil || u.Host == "" {
			return nil, fmt.Errorf("invalid K8S_API_URL %q", explicit)
		}
		if u.Scheme != "https" {
			return nil, fmt.Errorf("K8S_API_URL must use https, got %q", explicit)
		}
		transport := &trustedAPIServerTransport{
			server: strings.TrimRight(u.String(), "/"),
		}
		if explicitCA != "" {
			transport.caData = []byte(explicitCA)
		}
		return transport, nil
	}
	return nil, ErrNoTrustedAPIServer
}

// pinRestConfigToTrustedServer applies the platform-trusted apiserver and TLS trust to a
// config that already contains only the caller's inline bearer token. Fails closed if no
// trusted server is configured.
func pinRestConfigToTrustedServer(restConfig *rest.Config) error {
	if restConfig == nil {
		return nil
	}
	transport, err := resolveTrustedAPIServerTransport(inClusterCAPath)
	if err != nil {
		return err
	}

	restConfig.Host = transport.server
	// Trust is defined by the platform, never by the client kubeconfig.
	restConfig.TLSClientConfig.Insecure = false
	restConfig.TLSClientConfig.ServerName = ""
	restConfig.TLSClientConfig.CAData = transport.caData
	restConfig.TLSClientConfig.CAFile = transport.caFile
	return nil
}

// restConfigFromClientcmdConfig accepts only the active user's inline bearer token from a
// parsed kubeconfig. Transport and every other rest.Config field are created by the platform,
// so client-supplied credential plugins, file paths, proxies, and impersonation can never be
// installed in the API process. Every user-credentialed apiserver access is built here.
func restConfigFromClientcmdConfig(cfg *clientcmdapi.Config) (*rest.Config, error) {
	if cfg == nil {
		return nil, errors.New("kubeconfig is required")
	}

	for _, cluster := range cfg.Clusters {
		if cluster != nil && cluster.ProxyURL != "" {
			return nil, errors.New("kubeconfig proxy configuration is not supported")
		}
	}

	for _, authInfo := range cfg.AuthInfos {
		if authInfo == nil {
			continue
		}
		if authInfo.Exec != nil {
			return nil, errors.New("kubeconfig exec credentials are not supported")
		}
		if authInfo.AuthProvider != nil {
			return nil, errors.New("kubeconfig auth-provider credentials are not supported")
		}
		if authInfo.TokenFile != "" {
			return nil, errors.New("kubeconfig token-file credentials are not supported")
		}
		if authInfo.ClientCertificate != "" || authInfo.ClientKey != "" {
			return nil, errors.New("kubeconfig client credential files are not supported")
		}
		if len(authInfo.ClientCertificateData) != 0 || len(authInfo.ClientKeyData) != 0 {
			return nil, errors.New("kubeconfig client certificate credentials are not supported")
		}
		if authInfo.Username != "" || authInfo.Password != "" {
			return nil, errors.New("kubeconfig basic-auth credentials are not supported")
		}
		if authInfo.Impersonate != "" || authInfo.ImpersonateUID != "" ||
			len(authInfo.ImpersonateGroups) != 0 || len(authInfo.ImpersonateUserExtra) != 0 {
			return nil, errors.New("kubeconfig impersonation is not supported")
		}
	}

	contextName := strings.TrimSpace(cfg.CurrentContext)
	ctx := cfg.Contexts[contextName]
	if contextName == "" || ctx == nil {
		return nil, errors.New("kubeconfig current context is required")
	}
	clusterName := strings.TrimSpace(ctx.Cluster)
	if clusterName == "" || cfg.Clusters[clusterName] == nil {
		return nil, errors.New("kubeconfig current cluster is required")
	}
	authInfoName := strings.TrimSpace(ctx.AuthInfo)
	authInfo := cfg.AuthInfos[authInfoName]
	if authInfoName == "" || authInfo == nil {
		return nil, errors.New("kubeconfig current user is required")
	}
	token := strings.TrimSpace(authInfo.Token)
	if token == "" {
		return nil, errors.New("kubeconfig current user must use an inline bearer token")
	}

	restConfig := &rest.Config{BearerToken: token}
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
