# Accept Only Inline Bearer Tokens from User Kubeconfigs

The Go API receives a complete kubeconfig from an HTTP caller, but a kubeconfig is not a passive bearer-token envelope. Kubernetes clients can interpret it as instructions to execute credential plugins, read token or certificate files from the API container, install authentication providers, impersonate another subject, or route requests through a client-selected proxy. Calling clientcmd's `ClientConfig()` on that untrusted document therefore crosses the process boundary before Kubernetes RBAC can authenticate the request.

The API accepts only the active kubeconfig user's inline bearer token. The current context must name an existing cluster and user, and that user must contain a non-empty inline token. Any kubeconfig containing `exec`, `auth-provider`, `tokenFile`, client certificate or key material (inline or file-based), basic-auth credentials, impersonation, or a cluster proxy is rejected before a Kubernetes client is returned. The parsed document remains useful only for resolving the active user and namespace and for diagnostics.

`restConfigFromClientcmdConfig` constructs `rest.Config` from zero values rather than calling clientcmd's `ClientConfig()`: the bearer token is copied from the active user, while the server and CA come exclusively from the trusted transport decision in ADR-0046. No other client-supplied field can reach the API process's Kubernetes transport. This constructor remains the single seam shared by `RestConfigFromAuth` and `ResolveContext`, covering K8s, AP, DB, telemetry, logs, deployment, and terminal paths.

## Considered Options

- **Delete only `AuthInfo.Exec`.** Rejected: it leaves authentication providers, token and certificate file paths, impersonation, and proxy configuration as process-local or identity-changing inputs. A denylist at the final transport is also easier to regress than constructing the allowed config from zero values.
- **Keep inline client certificates as a second supported identity.** Rejected: Sealos currently issues service-account-token kubeconfigs, so the additional credential mode is unnecessary and expands parsing, key-handling, and compatibility risk.
- **Replace the kubeconfig HTTP envelope with a signed application session immediately.** Deferred: that is the preferable protocol boundary, but it changes UI, API, WebSocket, and deployment-task contracts. Token-only extraction closes the server-side execution path without changing the current caller contract.
- **Silently strip unsafe fields.** Rejected: failing closed makes unsupported clients visible, prevents ambiguous credential fallback, and gives operators evidence that a non-Sealos kubeconfig reached the service.

## Consequences

- Existing Sealos token kubeconfigs continue to authenticate as the same caller, against the same trusted apiserver, with Kubernetes RBAC remaining authoritative.
- Cloud-provider exec kubeconfigs, client-certificate kubeconfigs, basic auth, impersonation, and file-based credentials are intentionally unsupported by the Brain API.
- Credential plugins cannot run, credential paths cannot read API-container files, and a caller cannot install its own Kubernetes proxy through this boundary.
- The current URL-encoded kubeconfig header remains a compatibility envelope, not a statement that arbitrary kubeconfig features are supported. A future signed-session protocol can replace it without weakening this decision.
