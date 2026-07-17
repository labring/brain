package middleware

import (
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"k8s.io/client-go/rest"
)

// bearerFromKubeconfig url-encodes a kubeconfig and wraps it the way ConfigFromAuth /
// RestConfigFromAuth expect an Authorization header value.
func bearerFromKubeconfig(kubeconfig string) string {
	return "Bearer " + url.QueryEscape(kubeconfig)
}

// kubeconfigYAML renders a minimal, complete kubeconfig. server/token are the attacker- or
// caller-controlled parts; insecure toggles the client-supplied insecure-skip-tls-verify.
func kubeconfigYAML(server, token string, insecure bool) string {
	insecureLine := ""
	if insecure {
		insecureLine = "\n    insecure-skip-tls-verify: true"
	}
	return "apiVersion: v1\n" +
		"kind: Config\n" +
		"current-context: ctx\n" +
		"clusters:\n" +
		"- name: c\n" +
		"  cluster:\n" +
		"    server: " + server + insecureLine + "\n" +
		"contexts:\n" +
		"- name: ctx\n" +
		"  context:\n" +
		"    cluster: c\n" +
		"    user: u\n" +
		"    namespace: ns-victim\n" +
		"users:\n" +
		"- name: u\n" +
		"  user:\n" +
		"    token: " + token + "\n"
}

// clearInClusterEnv gives tests a deterministic off-cluster baseline even in CI Pods.
func clearInClusterEnv(t *testing.T) {
	t.Helper()
	t.Setenv("NODE_ENV", "development")
	t.Setenv("KUBERNETES_SERVICE_HOST", "")
	t.Setenv("KUBERNETES_SERVICE_PORT", "")
}

func mountedCAFile(t *testing.T) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "ca.crt")
	if err := os.WriteFile(path, []byte("mounted-cluster-ca"), 0o600); err != nil {
		t.Fatalf("write mounted CA fixture: %v", err)
	}
	return path
}

func restConfigFromAuthWithCAFile(auth, caFile string) (*rest.Config, error) {
	cfg, err := ConfigFromAuth(auth)
	if err != nil {
		return nil, err
	}
	return restConfigFromClientcmdConfigWithCAFile(cfg, caFile)
}

func TestRestConfigFromAuthPinsServerToInClusterAndKeepsIdentity(t *testing.T) {
	clearInClusterEnv(t)
	t.Setenv("KUBERNETES_SERVICE_HOST", "10.0.0.1")
	t.Setenv("KUBERNETES_SERVICE_PORT", "6443")
	caFile := mountedCAFile(t)

	// A caller pointing its kubeconfig at an apiserver it controls, with TLS verification
	// switched off — the exact fake-apiserver bypass the pin exists to defeat.
	kubeconfig := strings.Replace(
		kubeconfigYAML("https://attacker.example:6443", "caller-token", true),
		"    server: https://attacker.example:6443\n",
		"    server: https://attacker.example:6443\n    certificate-authority-data: YXR0YWNrZXItY2E=\n    tls-server-name: attacker.internal\n",
		1,
	)
	rc, err := restConfigFromAuthWithCAFile(bearerFromKubeconfig(kubeconfig), caFile)
	if err != nil {
		t.Fatalf("RestConfigFromAuth: %v", err)
	}

	if rc.Host != "https://10.0.0.1:6443" {
		t.Errorf("server not pinned to in-cluster apiserver: got %q", rc.Host)
	}
	if rc.BearerToken != "caller-token" {
		t.Errorf("caller identity not preserved: got token %q", rc.BearerToken)
	}
	if rc.TLSClientConfig.Insecure {
		t.Error("client insecure-skip-tls-verify was honored; TLS verification must stay on")
	}
	if rc.TLSClientConfig.ServerName != "" {
		t.Errorf("client-supplied TLS server name not cleared: got %q", rc.TLSClientConfig.ServerName)
	}
	if rc.TLSClientConfig.CAFile != caFile {
		t.Errorf("mounted in-cluster CA not selected: got %q", rc.TLSClientConfig.CAFile)
	}
	if len(rc.TLSClientConfig.CAData) != 0 {
		t.Errorf("client-supplied CA data not cleared: got %q", rc.TLSClientConfig.CAData)
	}
}

func TestRestConfigFromAuthRejectsUnsafeKubeconfigFeatures(t *testing.T) {
	clearInClusterEnv(t)
	t.Setenv("KUBERNETES_SERVICE_HOST", "10.0.0.1")
	t.Setenv("KUBERNETES_SERVICE_PORT", "6443")

	tokenFile := filepath.Join(t.TempDir(), "token")
	certFile := filepath.Join(t.TempDir(), "client.crt")
	keyFile := filepath.Join(t.TempDir(), "client.key")
	if err := os.WriteFile(tokenFile, []byte("file-token"), 0o600); err != nil {
		t.Fatalf("write token fixture: %v", err)
	}
	if err := os.WriteFile(certFile, []byte("client-certificate"), 0o600); err != nil {
		t.Fatalf("write client certificate fixture: %v", err)
	}
	if err := os.WriteFile(keyFile, []byte("client-key"), 0o600); err != nil {
		t.Fatalf("write client key fixture: %v", err)
	}
	const tokenLine = "    token: caller-token\n"
	base := kubeconfigYAML("https://cluster.example:6443", "caller-token", false)
	tests := []struct {
		name        string
		old         string
		replacement string
		wantError   string
	}{
		{
			name: "exec credentials",
			old:  tokenLine,
			replacement: tokenLine +
				"    exec:\n" +
				"      apiVersion: client.authentication.k8s.io/v1\n" +
				"      command: credential-plugin\n" +
				"      interactiveMode: Never\n",
			wantError: "exec credentials",
		},
		{
			name: "auth provider",
			old:  tokenLine,
			replacement: tokenLine +
				"    auth-provider:\n" +
				"      name: oidc\n" +
				"      config:\n" +
				"        id-token: caller-token\n",
			wantError: "auth-provider credentials",
		},
		{
			name:        "token file",
			old:         tokenLine,
			replacement: tokenLine + "    tokenFile: " + tokenFile + "\n",
			wantError:   "token-file credentials",
		},
		{
			name: "client credential files",
			old:  tokenLine,
			replacement: tokenLine +
				"    client-certificate: " + certFile + "\n" +
				"    client-key: " + keyFile + "\n",
			wantError: "client credential files",
		},
		{
			name: "inline client certificate",
			old:  tokenLine,
			replacement: tokenLine +
				"    client-certificate-data: Y2VydA==\n" +
				"    client-key-data: a2V5\n",
			wantError: "client certificate credentials",
		},
		{
			name: "basic auth",
			old:  tokenLine,
			replacement: tokenLine +
				"    username: caller\n" +
				"    password: password\n",
			wantError: "basic-auth credentials",
		},
		{
			name: "impersonated user",
			old:  tokenLine,
			replacement: tokenLine +
				"    as: system:admin\n",
			wantError: "impersonation",
		},
		{
			name: "impersonated UID",
			old:  tokenLine,
			replacement: tokenLine +
				"    as-uid: \"1000\"\n",
			wantError: "impersonation",
		},
		{
			name: "impersonated groups",
			old:  tokenLine,
			replacement: tokenLine +
				"    as-groups:\n" +
				"    - system:masters\n",
			wantError: "impersonation",
		},
		{
			name: "impersonated extras",
			old:  tokenLine,
			replacement: tokenLine +
				"    as-user-extra:\n" +
				"      scopes:\n" +
				"      - admin\n",
			wantError: "impersonation",
		},
		{
			name: "client proxy",
			old:  "    server: https://cluster.example:6443\n",
			replacement: "    server: https://cluster.example:6443\n" +
				"    proxy-url: http://attacker.example:8080\n",
			wantError: "proxy configuration",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			kubeconfig := strings.Replace(base, tt.old, tt.replacement, 1)
			if kubeconfig == base {
				t.Fatalf("test fixture did not add %s", tt.name)
			}
			_, _, err := RestConfigFromAuth(bearerFromKubeconfig(kubeconfig))
			if err == nil || !strings.Contains(err.Error(), tt.wantError) {
				t.Fatalf("expected %s to be rejected with %q, got %v", tt.name, tt.wantError, err)
			}
		})
	}
}

func TestRestConfigFromAuthRequiresInlineBearerToken(t *testing.T) {
	clearInClusterEnv(t)
	t.Setenv("KUBERNETES_SERVICE_HOST", "10.0.0.1")
	t.Setenv("KUBERNETES_SERVICE_PORT", "6443")

	kubeconfig := strings.Replace(
		kubeconfigYAML("https://cluster.example:6443", "caller-token", false),
		"    token: caller-token\n",
		"",
		1,
	)

	if _, _, err := RestConfigFromAuth(bearerFromKubeconfig(kubeconfig)); err == nil {
		t.Fatal("expected an inline bearer token to be required")
	}
}

func TestRestConfigFromAuthRequiresCurrentCluster(t *testing.T) {
	clearInClusterEnv(t)
	t.Setenv("KUBERNETES_SERVICE_HOST", "10.0.0.1")
	t.Setenv("KUBERNETES_SERVICE_PORT", "6443")

	kubeconfig := strings.Replace(
		kubeconfigYAML("https://cluster.example:6443", "caller-token", false),
		"    cluster: c\n",
		"",
		1,
	)

	if _, _, err := RestConfigFromAuth(bearerFromKubeconfig(kubeconfig)); err == nil {
		t.Fatal("expected the current context cluster to be required")
	}
}

func TestRestConfigFromAuthUsesCurrentKubeconfigTransportOffCluster(t *testing.T) {
	clearInClusterEnv(t)
	kubeconfig := strings.Replace(
		kubeconfigYAML("https://cluster.example:6443/", "caller-token", true),
		"    server: https://cluster.example:6443/\n",
		"    server: https://cluster.example:6443/\n    certificate-authority-data: bG9jYWwtY2E=\n    tls-server-name: api.internal\n",
		1,
	)
	rc, _, err := RestConfigFromAuth(bearerFromKubeconfig(kubeconfig))
	if err != nil {
		t.Fatalf("RestConfigFromAuth: %v", err)
	}
	if rc.Host != "https://cluster.example:6443" {
		t.Errorf("kubeconfig server not selected off-cluster: got %q", rc.Host)
	}
	if rc.BearerToken != "caller-token" {
		t.Errorf("caller identity not preserved: got token %q", rc.BearerToken)
	}
	if !rc.TLSClientConfig.Insecure {
		t.Error("off-cluster kubeconfig insecure-skip-tls-verify was not preserved")
	}
	if len(rc.TLSClientConfig.CAData) != 0 {
		t.Errorf("off-cluster kubeconfig CA must be ignored when TLS verification is disabled: got %q", string(rc.TLSClientConfig.CAData))
	}
	if rc.TLSClientConfig.ServerName != "api.internal" {
		t.Errorf("off-cluster kubeconfig TLS server name not preserved: got %q", rc.TLSClientConfig.ServerName)
	}
	if _, err := rest.TransportFor(rc); err != nil {
		t.Fatalf("off-cluster rest config cannot create a transport: %v", err)
	}
}

func TestRestConfigFromAuthUsesKubeconfigCAOffCluster(t *testing.T) {
	clearInClusterEnv(t)
	kubeconfig := strings.Replace(
		kubeconfigYAML("https://cluster.example:6443", "caller-token", false),
		"    server: https://cluster.example:6443\n",
		"    server: https://cluster.example:6443\n    certificate-authority-data: bG9jYWwtY2E=\n",
		1,
	)
	rc, _, err := RestConfigFromAuth(bearerFromKubeconfig(kubeconfig))
	if err != nil {
		t.Fatalf("RestConfigFromAuth: %v", err)
	}
	if string(rc.TLSClientConfig.CAData) != "local-ca" {
		t.Errorf("off-cluster kubeconfig CA not preserved: got %q", string(rc.TLSClientConfig.CAData))
	}
}

func TestRestConfigFromAuthRestrictsOffClusterTransport(t *testing.T) {
	t.Run("production", func(t *testing.T) {
		clearInClusterEnv(t)
		t.Setenv("NODE_ENV", "production")
		auth := bearerFromKubeconfig(kubeconfigYAML("https://cluster.example:6443", "caller-token", false))
		if _, _, err := RestConfigFromAuth(auth); err == nil || !strings.Contains(err.Error(), "only in development") {
			t.Fatalf("expected off-cluster production to fail closed, got %v", err)
		}
	})

	t.Run("remote HTTP", func(t *testing.T) {
		clearInClusterEnv(t)
		auth := bearerFromKubeconfig(kubeconfigYAML("http://cluster.example:6443", "caller-token", false))
		if _, _, err := RestConfigFromAuth(auth); err == nil || !strings.Contains(err.Error(), "HTTPS") {
			t.Fatalf("expected remote HTTP server to be rejected, got %v", err)
		}
	})

	t.Run("loopback HTTP", func(t *testing.T) {
		clearInClusterEnv(t)
		auth := bearerFromKubeconfig(kubeconfigYAML("http://127.0.0.1:6443", "caller-token", false))
		rc, _, err := RestConfigFromAuth(auth)
		if err != nil {
			t.Fatalf("expected loopback HTTP server to be accepted in development: %v", err)
		}
		if rc.Host != "http://127.0.0.1:6443" {
			t.Fatalf("unexpected loopback server: %q", rc.Host)
		}
	})
}

func TestRestConfigFromAuthPrefersInClusterAPIServer(t *testing.T) {
	clearInClusterEnv(t)
	t.Setenv("KUBERNETES_SERVICE_HOST", "10.0.0.1")
	t.Setenv("KUBERNETES_SERVICE_PORT", "6443")

	auth := bearerFromKubeconfig(kubeconfigYAML("https://attacker.example:6443", "caller-token", false))
	rc, err := restConfigFromAuthWithCAFile(auth, mountedCAFile(t))
	if err != nil {
		t.Fatalf("RestConfigFromAuth: %v", err)
	}
	if rc.Host != "https://10.0.0.1:6443" {
		t.Errorf("in-cluster apiserver did not take precedence: got %q", rc.Host)
	}
}

func TestRestConfigFromAuthFailsClosedWithPartialInClusterCoordinates(t *testing.T) {
	clearInClusterEnv(t)
	t.Setenv("KUBERNETES_SERVICE_HOST", "10.0.0.1")

	auth := bearerFromKubeconfig(kubeconfigYAML("https://attacker.example:6443", "caller-token", false))
	if _, _, err := RestConfigFromAuth(auth); err == nil || !strings.Contains(err.Error(), "in-cluster") {
		t.Fatalf("expected partial in-cluster configuration to fail closed, got %v", err)
	}
}

func TestRestConfigPinsServerToInClusterTransport(t *testing.T) {
	clearInClusterEnv(t)
	t.Setenv("KUBERNETES_SERVICE_HOST", "10.0.0.1")
	t.Setenv("KUBERNETES_SERVICE_PORT", "6443")

	cfg, err := ConfigFromAuth(bearerFromKubeconfig(kubeconfigYAML("https://attacker.example:6443", "caller-token", true)))
	if err != nil {
		t.Fatalf("ConfigFromAuth: %v", err)
	}
	restConfig, err := restConfigFromClientcmdConfigWithCAFile(cfg, mountedCAFile(t))
	if err != nil {
		t.Fatalf("restConfigFromClientcmdConfigWithCAFile: %v", err)
	}
	if restConfig.Host != "https://10.0.0.1:6443" {
		t.Errorf("rest config did not pin the server: got %q", restConfig.Host)
	}
	if restConfig.TLSClientConfig.Insecure {
		t.Error("rest config did not neutralize insecure-skip-tls-verify")
	}
}

func TestResolveContextUsesKubeconfigNamespaceOffCluster(t *testing.T) {
	clearInClusterEnv(t)

	cfg, err := ConfigFromAuth(bearerFromKubeconfig(kubeconfigYAML("https://cluster.example:6443", "caller-token", false)))
	if err != nil {
		t.Fatalf("ConfigFromAuth: %v", err)
	}
	resolved, err := ResolveContext(cfg, ResolveOptions{DefaultNamespace: "fallback"})
	if err != nil {
		t.Fatalf("ResolveContext: %v", err)
	}
	if resolved.RestConfig.Host != "https://cluster.example:6443" {
		t.Errorf("ResolveContext did not use kubeconfig server: got %q", resolved.RestConfig.Host)
	}
	if resolved.Namespace != "ns-victim" {
		t.Errorf("namespace resolution changed: got %q, want ns-victim", resolved.Namespace)
	}
}

func TestInClusterAPIServerTransportUsesMountedCA(t *testing.T) {
	clearInClusterEnv(t)
	t.Setenv("KUBERNETES_SERVICE_HOST", "10.0.0.1")
	t.Setenv("KUBERNETES_SERVICE_PORT", "6443")
	caFile := mountedCAFile(t)

	transport, inCluster, err := resolveInClusterAPIServerTransport(caFile)
	if err != nil {
		t.Fatalf("resolveInClusterAPIServerTransport: %v", err)
	}
	if !inCluster {
		t.Fatal("expected in-cluster transport")
	}
	if transport.server != "https://10.0.0.1:6443" {
		t.Errorf("in-cluster server not selected: got %q", transport.server)
	}
	if transport.caFile != caFile {
		t.Errorf("mounted in-cluster CA not selected: got %q", transport.caFile)
	}
}

func TestInClusterAPIServerTransportRejectsMissingMountedCA(t *testing.T) {
	clearInClusterEnv(t)
	t.Setenv("KUBERNETES_SERVICE_HOST", "10.0.0.1")
	t.Setenv("KUBERNETES_SERVICE_PORT", "6443")

	missingCAFile := filepath.Join(t.TempDir(), "missing-ca.crt")
	if _, _, err := resolveInClusterAPIServerTransport(missingCAFile); err == nil || !strings.Contains(err.Error(), "CA") {
		t.Fatalf("expected missing in-cluster CA error, got %v", err)
	}
}
