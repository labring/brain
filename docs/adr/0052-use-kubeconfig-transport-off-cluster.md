# Use In-Cluster Kubernetes Transport in Pods and Kubeconfig Transport Off-Cluster

Brain receives a kubeconfig with each user-credentialed Kubernetes request. The active user's inline bearer token is the request identity. Transport selection has two different trust boundaries: deployed Brain services must stay on their own cluster's internal API endpoint, while a developer running Brain off-cluster must be able to reach the cluster named by the kubeconfig without duplicating that endpoint and CA in application environment variables.

When `KUBERNETES_SERVICE_HOST` and `KUBERNETES_SERVICE_PORT` show that Brain is running in a Pod, every user-credentialed request is pinned to that injected API endpoint and the mounted service-account CA. The user's kubeconfig server, CA, TLS server name, and insecure setting are ignored. The service-account token is not used; Kubernetes RBAC evaluates the user's inline bearer token. Partial in-cluster coordinates or a missing mounted CA fail closed instead of falling back to the user-declared transport.

When both in-cluster coordinates are absent and `NODE_ENV=development`, Brain uses the active kubeconfig context's cluster transport: server, inline certificate authority data, TLS server name, and insecure-skip-tls-verify. Remote endpoints must use HTTPS; HTTP is accepted only for loopback endpoints. This is the local `bun dev` model, and the API development script sets the mode explicitly. It supports a developer connecting Brain to a local or remote test cluster without separate `K8S_API_URL` or `K8S_API_CA` configuration. An off-cluster process outside development fails closed.

Transport selection does not broaden the credential contract. Brain uses only the active inline bearer token for identity. Next namespace verification extracts the supported inline token and transport fields without executing other kubeconfig credential mechanisms; the Go API rejects exec and auth-provider plugins, token and certificate files, client certificates, basic authentication, proxy configuration, and impersonation before Kubernetes resource access. A self-contained kubeconfig remains the supported request credential.

Public or shared off-cluster production deployment is not supported by this decision and fails closed. If that topology is required later, it must introduce a server-owned endpoint allowlist or another explicit trusted-transport model rather than reusing the local-development fallback.

## Considered Options

- Keep `K8S_API_URL` and `K8S_API_CA` as off-cluster overrides: rejected because they duplicate the active kubeconfig transport during local development and can drift from the cluster the developer selected.
- Always use the kubeconfig transport: rejected because a production requester could name a fake API server, return a forged authorization result, or make Brain issue server-side requests to an attacker-selected destination.
- Add a custom development-mode variable: rejected in favor of the existing `NODE_ENV=development` runtime boundary already established by the Next.js development server and set explicitly by the Go API development script.

## Consequences

The two application environment variables are removed. Production deployments rely on Kubernetes-injected API coordinates and the default mounted service-account CA, while local development relies on a self-contained kubeconfig under the existing development mode. Disabling the service-account CA mount for the UI or API Pods is incompatible with user-credentialed Kubernetes access and produces an explicit configuration failure.
