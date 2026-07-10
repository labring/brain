package middleware

import (
	"errors"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
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

// clearTrustedServerEnv blanks every source trustedAPIServer/CA reads so a test starts from a
// known "off-cluster, unconfigured" baseline regardless of where it runs (a CI pod would
// otherwise leak KUBERNETES_SERVICE_HOST into the assertions).
func clearTrustedServerEnv(t *testing.T) {
	t.Helper()
	t.Setenv("K8S_API_URL", "")
	t.Setenv("K8S_API_CA", "")
	t.Setenv("KUBERNETES_SERVICE_HOST", "")
	t.Setenv("KUBERNETES_SERVICE_PORT", "")
}

func TestRestConfigFromAuthPinsServerToInClusterAndKeepsIdentity(t *testing.T) {
	clearTrustedServerEnv(t)
	t.Setenv("KUBERNETES_SERVICE_HOST", "10.0.0.1")
	t.Setenv("KUBERNETES_SERVICE_PORT", "6443")

	// A caller pointing its kubeconfig at an apiserver it controls, with TLS verification
	// switched off — the exact fake-apiserver bypass the pin exists to defeat.
	auth := bearerFromKubeconfig(kubeconfigYAML("https://attacker.example:6443", "caller-token", true))
	rc, _, err := RestConfigFromAuth(auth)
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
}

func TestRestConfigFromAuthRejectsUnsafeKubeconfigFeatures(t *testing.T) {
	clearTrustedServerEnv(t)
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
	clearTrustedServerEnv(t)
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
	clearTrustedServerEnv(t)
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

func TestRestConfigFromAuthFailsClosedWithoutTrustedServer(t *testing.T) {
	clearTrustedServerEnv(t)

	auth := bearerFromKubeconfig(kubeconfigYAML("https://attacker.example:6443", "caller-token", false))
	if _, _, err := RestConfigFromAuth(auth); !errors.Is(err, ErrNoTrustedAPIServer) {
		t.Fatalf("expected ErrNoTrustedAPIServer when no trusted server is configured, got %v", err)
	}
}

func TestRestConfigFromAuthPrefersInClusterAPIServer(t *testing.T) {
	clearTrustedServerEnv(t)
	t.Setenv("KUBERNETES_SERVICE_HOST", "10.0.0.1")
	t.Setenv("KUBERNETES_SERVICE_PORT", "6443")
	t.Setenv("K8S_API_URL", "https://trusted.internal:6443/")

	auth := bearerFromKubeconfig(kubeconfigYAML("https://attacker.example:6443", "caller-token", false))
	rc, _, err := RestConfigFromAuth(auth)
	if err != nil {
		t.Fatalf("RestConfigFromAuth: %v", err)
	}
	if rc.Host != "https://10.0.0.1:6443" {
		t.Errorf("in-cluster apiserver did not take precedence: got %q", rc.Host)
	}
}

func TestRestConfigFromAuthUsesExplicitAPIServerOffCluster(t *testing.T) {
	clearTrustedServerEnv(t)
	t.Setenv("K8S_API_URL", "https://trusted.internal:6443/")

	auth := bearerFromKubeconfig(kubeconfigYAML("https://attacker.example:6443", "caller-token", false))
	rc, _, err := RestConfigFromAuth(auth)
	if err != nil {
		t.Fatalf("RestConfigFromAuth: %v", err)
	}
	if rc.Host != "https://trusted.internal:6443" {
		t.Errorf("off-cluster K8S_API_URL not honored (or trailing slash kept): got %q", rc.Host)
	}
	if rc.BearerToken != "caller-token" {
		t.Errorf("caller identity not preserved: got token %q", rc.BearerToken)
	}
}

func TestRestConfigFromAuthFailsClosedWithPartialInClusterCoordinates(t *testing.T) {
	clearTrustedServerEnv(t)
	t.Setenv("KUBERNETES_SERVICE_HOST", "10.0.0.1")
	t.Setenv("K8S_API_URL", "https://trusted.internal:6443")

	auth := bearerFromKubeconfig(kubeconfigYAML("https://attacker.example:6443", "caller-token", false))
	if _, _, err := RestConfigFromAuth(auth); err == nil || !strings.Contains(err.Error(), "in-cluster") {
		t.Fatalf("expected partial in-cluster configuration to fail closed, got %v", err)
	}
}

func TestRestConfigFromAuthAppliesExplicitCAAndDropsFile(t *testing.T) {
	clearTrustedServerEnv(t)
	t.Setenv("K8S_API_URL", "https://trusted.internal:6443")
	pem := "-----BEGIN CERTIFICATE-----\nQUFBQQ==\n-----END CERTIFICATE-----"
	t.Setenv("K8S_API_CA", pem)

	auth := bearerFromKubeconfig(kubeconfigYAML("https://attacker.example:6443", "caller-token", true))
	rc, _, err := RestConfigFromAuth(auth)
	if err != nil {
		t.Fatalf("RestConfigFromAuth: %v", err)
	}
	if string(rc.TLSClientConfig.CAData) != pem {
		t.Errorf("explicit K8S_API_CA not applied: got CAData %q", string(rc.TLSClientConfig.CAData))
	}
	if rc.TLSClientConfig.CAFile != "" {
		t.Errorf("CAFile should be empty when CAData is set: got %q", rc.TLSClientConfig.CAFile)
	}
	if rc.TLSClientConfig.Insecure {
		t.Error("insecure-skip-tls-verify must be neutralized even with an explicit CA")
	}
}

func TestResolveContextPinsServerAndResolvesNamespace(t *testing.T) {
	clearTrustedServerEnv(t)
	t.Setenv("KUBERNETES_SERVICE_HOST", "10.0.0.1")
	t.Setenv("KUBERNETES_SERVICE_PORT", "6443")

	cfg, err := ConfigFromAuth(bearerFromKubeconfig(kubeconfigYAML("https://attacker.example:6443", "caller-token", true)))
	if err != nil {
		t.Fatalf("ConfigFromAuth: %v", err)
	}
	resolved, err := ResolveContext(cfg, ResolveOptions{DefaultNamespace: "fallback"})
	if err != nil {
		t.Fatalf("ResolveContext: %v", err)
	}
	if resolved.RestConfig.Host != "https://10.0.0.1:6443" {
		t.Errorf("ResolveContext did not pin the server: got %q", resolved.RestConfig.Host)
	}
	if resolved.RestConfig.TLSClientConfig.Insecure {
		t.Error("ResolveContext did not neutralize insecure-skip-tls-verify")
	}
	if resolved.Namespace != "ns-victim" {
		t.Errorf("namespace resolution changed: got %q, want the kubeconfig context namespace", resolved.Namespace)
	}
}

func TestResolveContextFailsClosedWithoutTrustedServer(t *testing.T) {
	clearTrustedServerEnv(t)

	cfg, err := ConfigFromAuth(bearerFromKubeconfig(kubeconfigYAML("https://attacker.example:6443", "caller-token", false)))
	if err != nil {
		t.Fatalf("ConfigFromAuth: %v", err)
	}
	if _, err := ResolveContext(cfg, ResolveOptions{DefaultNamespace: "fallback"}); !errors.Is(err, ErrNoTrustedAPIServer) {
		t.Fatalf("expected ErrNoTrustedAPIServer, got %v", err)
	}
}

func TestTrustedAPIServerRejectsNonHTTPSExplicitURL(t *testing.T) {
	clearTrustedServerEnv(t)
	t.Setenv("K8S_API_URL", "http://trusted.internal:6443")

	_, err := resolveTrustedAPIServerTransport(inClusterCAPath)
	if err == nil || !strings.Contains(err.Error(), "https") {
		t.Fatalf("expected an https-required error for a plaintext K8S_API_URL, got %v", err)
	}
}

func TestTrustedAPIServerTransportPrefersMountedCAForInClusterEndpoint(t *testing.T) {
	clearTrustedServerEnv(t)
	t.Setenv("KUBERNETES_SERVICE_HOST", "10.0.0.1")
	t.Setenv("KUBERNETES_SERVICE_PORT", "6443")
	t.Setenv("K8S_API_URL", "https://off-cluster.example:6443")
	t.Setenv("K8S_API_CA", "stale-development-ca")

	caFile := filepath.Join(t.TempDir(), "ca.crt")
	if err := os.WriteFile(caFile, []byte("mounted-cluster-ca"), 0o600); err != nil {
		t.Fatalf("write mounted CA fixture: %v", err)
	}

	transport, err := resolveTrustedAPIServerTransport(caFile)
	if err != nil {
		t.Fatalf("resolveTrustedAPIServerTransport: %v", err)
	}
	if transport.server != "https://10.0.0.1:6443" {
		t.Errorf("in-cluster server not selected: got %q", transport.server)
	}
	if transport.caFile != caFile {
		t.Errorf("mounted in-cluster CA not selected: got %q", transport.caFile)
	}
	if len(transport.caData) != 0 {
		t.Errorf("stale explicit CA must be ignored when mounted CA exists: got %q", transport.caData)
	}
}

func TestTrustedAPIServerTransportFallsBackToExplicitCAWhenMountIsMissing(t *testing.T) {
	clearTrustedServerEnv(t)
	t.Setenv("KUBERNETES_SERVICE_HOST", "10.0.0.1")
	t.Setenv("KUBERNETES_SERVICE_PORT", "6443")
	t.Setenv("K8S_API_CA", "operator-cluster-ca")

	missingCAFile := filepath.Join(t.TempDir(), "missing-ca.crt")
	transport, err := resolveTrustedAPIServerTransport(missingCAFile)
	if err != nil {
		t.Fatalf("resolveTrustedAPIServerTransport: %v", err)
	}
	if string(transport.caData) != "operator-cluster-ca" {
		t.Errorf("explicit CA fallback not selected: got %q", transport.caData)
	}
	if transport.caFile != "" {
		t.Errorf("missing mounted CA must not be returned: got %q", transport.caFile)
	}
}
