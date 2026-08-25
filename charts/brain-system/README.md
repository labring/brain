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

Create the private values file once in a persistent, user-readable-only
location. Do not recreate or overwrite it during upgrades because it contains
stable encryption keys:

```bash
private_values_dir="${XDG_CONFIG_HOME:-$HOME/.config}/brain"
private_values_file="$private_values_dir/brain-system.values.yaml"
mkdir -p -m 700 "$private_values_dir"
if [ ! -e "$private_values_file" ]; then
  install -m 600 charts/brain-system/values.local.example.yaml "$private_values_file"
fi
```

Back up this file through the operator's approved secret-management process,
then edit `$private_values_file`, especially:

- `api.env.VLSELECT_*` or `api.env.VMAUTH_SECRET_*` if VictoriaLogs requires authentication
- GitHub App and OAuth values (`GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_OAUTH_CLIENT_ID`, `GITHUB_OAUTH_CLIENT_SECRET`)
- `GITHUB_USER_TOKEN_ENCRYPTION_KEY`: keep stable; changing it prevents decrypting previously stored GitHub user tokens
- assistant model values (`SYSTEM_OPENAI_*`, `FREE_CHAT_TURNS`, `AI_PROXY_TOKEN_NAME`)
- optional GitHub Deploy OpenAI override (`GITHUB_DEPLOY_OPENAI_API_KEY`, `GITHUB_DEPLOY_OPENAI_BASE_URL`); when both are set, GitHub Deploy uses them instead of the caller's AI Proxy. If they are unset, GitHub Deploy reuses `CODEX_GATEWAY_OPENAI_*` then `SYSTEM_OPENAI_*` when that pair is complete
- `MARKETING_EVENTS_INGEST_SECRET`: shared bearer secret for trusted lifecycle event producers
- `MARKETING_CONSENT_SIGNING_KEY`: shared HS256 secret used to verify Desktop-issued consent tokens
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

When left empty, `ui.env.API_URL` and `ui.env.APP_URL` are derived from the API/UI Ingress hosts rendered by this chart.

`ui.env.DATABASE_URL` and `api.env.DATABASE_URL` are derived from the chart-created `brain-pg-conn-credential` Secret when left empty. `api.env.DB_PUBLIC_HOST`, `api.env.WHODB_URL`, and `ui.env.DEVBOX_API_BASE_URL` are also derived from the release namespace or platform cloud domain when left empty. `ui.env.ACCOUNT_API_BASE_URL` derives to the in-cluster `http://account-service.account-system.svc:2333` address when left empty.

`ui.env.BILLING_CURRENCY` controls the Billing Area's cluster-level display currency and defaults to `usd`. `ui.env.BILLING_GPU_ENABLED` controls GPU quota and pricing rows and defaults to `false`. Both values are read by the UI server at request time.

`ui.env.BILLING_LOCAL_REGION_DOMAIN` declares which region of the platform's region catalog this deployment belongs to; billing verifies it against the catalog and refuses to render when it is missing or unknown. It derives from the platform cloud domain when left empty — set it explicitly only when the two differ.

Install or upgrade:

```bash
charts/brain-system/install.sh "$private_values_file"
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

## Roll Back

Inspect the release history, then roll back to a known-good revision:

```bash
helm history brain-system -n brain-system
helm rollback brain-system <revision> -n brain-system --wait --timeout=15m
```

Verify the workloads after rollback:

```bash
kubectl -n brain-system get deploy,pod,svc,ingress,cluster -o wide
kubectl -n brain-system rollout status deploy/brain-api-staging --timeout=5m
kubectl -n brain-system rollout status deploy/brain-ui-staging --timeout=5m
kubectl -n brain-system rollout status deploy/whodb --timeout=5m
```

Do not use `helm uninstall` as a routine rollback mechanism because it can
affect the stateful `brain-pg` resources.
