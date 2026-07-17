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

type kubernetesAPIServerTransport struct {
	server string
	caData []byte
	caFile string
}

// resolveInClusterAPIServerTransport reports whether the process is running in a Pod. When it
// is, both the Kubernetes-injected endpoint and mounted CA are mandatory; callers must not fall
// back to a client-declared server from an in-cluster process.
func resolveInClusterAPIServerTransport(inClusterCAFile string) (*kubernetesAPIServerTransport, bool, error) {
	host := strings.TrimSpace(os.Getenv("KUBERNETES_SERVICE_HOST"))
	port := strings.TrimSpace(os.Getenv("KUBERNETES_SERVICE_PORT"))
	if (host == "") != (port == "") {
		return nil, false, fmt.Errorf(
			"in-cluster Kubernetes API server configuration is incomplete: KUBERNETES_SERVICE_HOST and KUBERNETES_SERVICE_PORT must both be set",
		)
	}
	if host == "" {
		return nil, false, nil
	}
	if inClusterCAFile == "" {
		return nil, true, errors.New("in-cluster Kubernetes API server CA path is empty")
	}
	if _, err := os.Stat(inClusterCAFile); err != nil {
		return nil, true, fmt.Errorf("in-cluster Kubernetes API server CA is unavailable: %w", err)
	}
	return &kubernetesAPIServerTransport{
		server: "https://" + net.JoinHostPort(host, port),
		caFile: inClusterCAFile,
	}, true, nil
}

func applyInClusterTransport(restConfig *rest.Config, transport *kubernetesAPIServerTransport) {
	restConfig.Host = transport.server
	restConfig.TLSClientConfig.Insecure = false
	restConfig.TLSClientConfig.ServerName = ""
	restConfig.TLSClientConfig.CAData = transport.caData
	restConfig.TLSClientConfig.CAFile = transport.caFile
}

func applyKubeconfigTransport(restConfig *rest.Config, cluster *clientcmdapi.Cluster) error {
	server := strings.TrimSpace(cluster.Server)
	u, err := url.Parse(server)
	if err != nil || u.Host == "" {
		return fmt.Errorf("kubeconfig current cluster server is invalid")
	}
	if u.Scheme != "https" && !(u.Scheme == "http" && isLoopbackURL(u)) {
		return errors.New("kubeconfig current cluster server must use HTTPS unless it is loopback")
	}

	restConfig.Host = strings.TrimRight(u.String(), "/")
	restConfig.TLSClientConfig.Insecure = cluster.InsecureSkipTLSVerify
	restConfig.TLSClientConfig.ServerName = cluster.TLSServerName
	if !cluster.InsecureSkipTLSVerify {
		restConfig.TLSClientConfig.CAData = append([]byte(nil), cluster.CertificateAuthorityData...)
	}
	restConfig.TLSClientConfig.CAFile = ""
	return nil
}

func isLoopbackURL(u *url.URL) bool {
	host := u.Hostname()
	if strings.EqualFold(host, "localhost") {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

// restConfigFromClientcmdConfig accepts only the active user's inline bearer token from a
// parsed kubeconfig. In a Pod, transport is pinned to the Kubernetes-injected endpoint and CA;
// off-cluster development uses the active kubeconfig cluster transport. Credential plugins,
// file paths, proxies, and impersonation are never installed in the API process.
func restConfigFromClientcmdConfig(cfg *clientcmdapi.Config) (*rest.Config, error) {
	return restConfigFromClientcmdConfigWithCAFile(cfg, inClusterCAPath)
}

func restConfigFromClientcmdConfigWithCAFile(cfg *clientcmdapi.Config, inClusterCAFile string) (*rest.Config, error) {
	if cfg == nil {
		return nil, errors.New("kubeconfig is required")
	}

	for _, cluster := range cfg.Clusters {
		if cluster == nil {
			continue
		}
		if cluster.ProxyURL != "" {
			return nil, errors.New("kubeconfig proxy configuration is not supported")
		}
		if cluster.CertificateAuthority != "" {
			return nil, errors.New("kubeconfig certificate-authority files are not supported")
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
	cluster := cfg.Clusters[clusterName]
	if clusterName == "" || cluster == nil {
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
	transport, inCluster, err := resolveInClusterAPIServerTransport(inClusterCAFile)
	if err != nil {
		return nil, err
	}
	if inCluster {
		applyInClusterTransport(restConfig, transport)
	} else {
		if strings.TrimSpace(os.Getenv("NODE_ENV")) != "development" {
			return nil, errors.New("off-cluster kubeconfig transport is available only in development")
		}
		if err := applyKubeconfigTransport(restConfig, cluster); err != nil {
			return nil, err
		}
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
	// Server is the hostname declared in the kubeconfig, retained for routing-domain
	// diagnostics. In a Pod, RestConfig is pinned to the internal apiserver instead.
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
