# brain-system Helm Chart

This chart is the preferred entrypoint for deploying the `brain-system` stack.

It renders:

- native Kubernetes `Deployment`, `Service`, and `Ingress` resources for `brain-api-staging`, `brain-ui-staging`, and `brain-registry`
- native KubeBlocks `Cluster` resources for the app database
- native Kubernetes `Deployment` and `Service`: `whodb`
- optional image pull `Secret`

## Prerequisites

The cluster must already have these platform resources installed:

- KubeBlocks with PostgreSQL support
- ingress-nginx `IngressClass/nginx`
- cert-manager when custom domains or per-domain certificates are used
- VictoriaMetrics and VictoriaLogs if API metrics/log endpoints are used

## Install

Create a private values file:

```bash
cp charts/brain-system/values.local.example.yaml /tmp/brain-system.values.yaml
```

Edit `/tmp/brain-system.values.yaml`, especially:

- `api.env.VLSELECT_*` or `api.env.VMAUTH_SECRET_*` if VictoriaLogs requires authentication
- GitHub App and OAuth values (`GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_OAUTH_CLIENT_ID`, `GITHUB_OAUTH_CLIENT_SECRET`)
- `GITHUB_USER_TOKEN_ENCRYPTION_KEY`: keep stable; changing it prevents decrypting previously stored GitHub user tokens
- assistant model values (`SYSTEM_OPENAI_*`, `FREE_CHAT_TURNS`, `AI_PROXY_TOKEN_NAME`)
- `JWT_INTERNAL`: the cluster-shared secret used for app-token verification and account-service request signing
- Devbox runtime values (`DEVBOX_TOKEN` or `DEVBOX_JWT_SIGNING_KEY`)
- `imagePullSecret.create`: keep `true` when the chart should create and reference `ghcr-cred`
- `apPublicAccess.userDomains`: AP platform domain suffixes and their wildcard TLS Secrets; AP creation currently uses the first entry

Configure the GitHub App registration to use the Brain UI origin:

```text
Setup URL: https://<ui-host>/api/callback/github
Redirect on update: enabled
Request user authorization (OAuth) during installation: disabled
```

`Redirect on update` lets repository-selection changes return to Brain so the
installation popup can close and refresh the workspace repository list.

The install script reads `cloudDomain` and `cloudPort` from
`sealos-system/sealos-config` and passes them to Helm. Keep these values empty
in private values files unless you intentionally want to override the platform
config.

Configure the domain suffix and TLS Secret used by Brain-created AP Ingresses:

```yaml
apPublicAccess:
  userDomains:
    - name: gzg.sealos.run
      secretName: wildcard-cert
    - name: sealosgzg.site
      secretName: wildcard-cert
```

AP creation currently uses `userDomains[0]`; the remaining entries are reserved
for future user-selectable domain support. When the list is empty, the chart
uses `global.cloudDomain` and `wildcard-cert`. Each configured Secret must exist
in the namespace where the AP is created.

Each `platformAddresses[].domainPrefix`, when set, must be a DNS-1123 label.
Leave it empty for a deterministic generated prefix. This allows an isolated
release to use a temporary hostname and later switch to the production prefix
without renaming its Kubernetes resources.

When left empty, `ui.env.API_URL` and `ui.env.NEXT_PUBLIC_APP_URL` are derived from the API/UI Ingress hosts rendered by this chart.

`ui.env.DATABASE_URL` and `api.env.DATABASE_URL` are derived from the chart-created `brain-pg-conn-credential` Secret when left empty. `api.env.DB_PUBLIC_HOST`, `api.env.WHODB_URL`, and `ui.env.DEVBOX_API_BASE_URL` are also derived from the release namespace or platform cloud domain when left empty. `ui.env.ACCOUNT_API_BASE_URL` derives to the in-cluster `http://account-service.account-system.svc:2333` address when left empty.

Install or upgrade:

```bash
charts/brain-system/install.sh /tmp/brain-system.values.yaml
```

## Database Credentials

The chart creates a KubeBlocks Cluster named `brain-pg`. KubeBlocks generates `brain-pg-conn-credential`, and the app Deployments reference that Secret to assemble `DATABASE_URL` at runtime.

Application environment variables are rendered directly into the app Deployments. The chart only creates a Kubernetes Secret for image pull credentials, because app env Secrets do not provide encryption by themselves and add little value here.

## Verify

```bash
kubectl -n brain-system get deploy,pod,svc,ingress,hpa,cluster -o wide
kubectl -n brain-system rollout status deploy/whodb --timeout=5m
```

For app and database resources:

```bash
kubectl -n brain-system get deploy,svc,ingress -l app.kubernetes.io/instance=brain-system
kubectl -n brain-system get cluster -l sealos-db-provider-cr=brain-pg
```
