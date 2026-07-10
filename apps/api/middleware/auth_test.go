package middleware

import (
	"errors"
	"net/url"
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

func TestRestConfigFromAuthFailsClosedWithoutTrustedServer(t *testing.T) {
	clearTrustedServerEnv(t)

	auth := bearerFromKubeconfig(kubeconfigYAML("https://attacker.example:6443", "caller-token", false))
	if _, _, err := RestConfigFromAuth(auth); !errors.Is(err, ErrNoTrustedAPIServer) {
		t.Fatalf("expected ErrNoTrustedAPIServer when no trusted server is configured, got %v", err)
	}
}

func TestRestConfigFromAuthHonorsExplicitK8SAPIURL(t *testing.T) {
	clearTrustedServerEnv(t)
	// Explicit override wins even when in-cluster coordinates are also present.
	t.Setenv("KUBERNETES_SERVICE_HOST", "10.0.0.1")
	t.Setenv("KUBERNETES_SERVICE_PORT", "6443")
	t.Setenv("K8S_API_URL", "https://trusted.internal:6443/")

	auth := bearerFromKubeconfig(kubeconfigYAML("https://attacker.example:6443", "caller-token", false))
	rc, _, err := RestConfigFromAuth(auth)
	if err != nil {
		t.Fatalf("RestConfigFromAuth: %v", err)
	}
	if rc.Host != "https://trusted.internal:6443" {
		t.Errorf("explicit K8S_API_URL not honored (or trailing slash kept): got %q", rc.Host)
	}
}

func TestRestConfigFromAuthAppliesExplicitCAAndDropsFile(t *testing.T) {
	clearTrustedServerEnv(t)
	t.Setenv("KUBERNETES_SERVICE_HOST", "10.0.0.1")
	t.Setenv("KUBERNETES_SERVICE_PORT", "6443")
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

	_, err := trustedAPIServer()
	if err == nil || !strings.Contains(err.Error(), "https") {
		t.Fatalf("expected an https-required error for a plaintext K8S_API_URL, got %v", err)
	}
}

func TestTrustedAPIServerCAPrefersExplicitPEMOverInClusterFile(t *testing.T) {
	clearTrustedServerEnv(t)
	pem := "-----BEGIN CERTIFICATE-----\nQUFBQQ==\n-----END CERTIFICATE-----"
	t.Setenv("K8S_API_CA", pem)

	caData, caFile := trustedAPIServerCA()
	if string(caData) != pem {
		t.Errorf("explicit CA not returned: got %q", string(caData))
	}
	if caFile != "" {
		t.Errorf("in-cluster CA file must not be used when K8S_API_CA is set: got %q", caFile)
	}
}
