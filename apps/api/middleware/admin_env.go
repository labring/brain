package middleware

import (
	"fmt"
	"net/url"
	"os"
	"strings"

	"k8s.io/client-go/tools/clientcmd"
	clientcmdapi "k8s.io/client-go/tools/clientcmd/api"
)

// AdminKubeconfigFromEnv loads client configuration from ENCODED_ADMIN_KUBECONFIG
// (URL-encoded kubeconfig YAML). Used for admin-only service integration reads.
func AdminKubeconfigFromEnv() (*clientcmdapi.Config, error) {
	encoded := strings.TrimSpace(os.Getenv("ENCODED_ADMIN_KUBECONFIG"))
	if encoded == "" {
		return nil, fmt.Errorf("ENCODED_ADMIN_KUBECONFIG is not set")
	}
	decoded, err := url.QueryUnescape(encoded)
	if err != nil {
		return nil, fmt.Errorf("ENCODED_ADMIN_KUBECONFIG: %w", err)
	}
	return clientcmd.Load([]byte(decoded))
}

// AdminAuthorizationBearer returns an Authorization header value suitable for
// RestConfigFromAuth: "Bearer " + url-encoded kubeconfig from env.
func AdminAuthorizationBearer() (string, error) {
	encoded := strings.TrimSpace(os.Getenv("ENCODED_ADMIN_KUBECONFIG"))
	if encoded == "" {
		return "", fmt.Errorf("ENCODED_ADMIN_KUBECONFIG is not set")
	}
	return "Bearer " + encoded, nil
}
