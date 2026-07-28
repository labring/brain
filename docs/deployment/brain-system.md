# brain-system Deployment Runbook

This runbook describes the current `brain-system` deployment model after AP/DB orchestration and AP public access support moved to direct Kubernetes and KubeBlocks resources.

## Architecture

`brain-system` is deployed through the Helm chart in `charts/brain-system`.

The chart renders:

- Native Kubernetes `Deployment`, `Service`, and `Ingress` resources for `brain-api-staging`, `brain-ui-staging`, and `brain-registry`.
- Native KubeBlocks `Cluster` resources for `brain-pg`.
- Native Kubernetes `Deployment` and `Service` for `whodb`.
- Optional image pull `Secret`.

The chart renders system resources with Helm, Sealos, and KubeBlocks labels. It does not stamp Brain project ownership labels because `brain-system` is not a user project resource.

## Platform Prerequisites

Install or verify these platform components before deploying the stack:

- KubeBlocks with PostgreSQL support.
- ingress-nginx with `IngressClass/nginx`.
- cert-manager when custom domains or per-domain certificates are used.
- VictoriaMetrics and VictoriaLogs when API metrics/log endpoints are used.

No repo-level platform manifest list is required for AP/DB product resources. The chart output is the deployment source of truth for this stack.

## Install

Create a private values file:

```bash
cp charts/brain-system/values.local.example.yaml /tmp/brain-system.values.yaml
```

Edit `/tmp/brain-system.values.yaml`, especially:

- GitHub App and OAuth values
- `GITHUB_USER_TOKEN_ENCRYPTION_KEY`: keep stable; changing it prevents decrypting previously stored GitHub user tokens
- assistant model values
- Devbox runtime values
- optional `DEPLOY_SKILL_SOURCE`; leave empty to use
  `https://github.com/labring/sealos-skills/tree/brain-deploy`
- `imagePullSecret.create`

Configure the GitHub App registration to match the UI origin:

```text
Setup URL: https://<ui-host>/api/callback/github
Redirect on update: enabled
Request user authorization (OAuth) during installation: disabled
```

`Redirect on update` is required so repository-selection changes return to Brain
and the GitHub popup can close after users add or remove repositories.

The install script reads `cloudDomain` and `cloudPort` from `sealos-system/sealos-config` and passes them to Helm. When left empty, `ui.env.API_URL` and `ui.env.NEXT_PUBLIC_APP_URL` are derived from the API/UI Ingress hosts rendered by this chart. `ui.env.DATABASE_URL` and `api.env.DATABASE_URL` are derived from the chart-created `brain-pg-conn-credential` Secret. `api.env.DB_PUBLIC_HOST`, `api.env.WHODB_URL`, and `ui.env.DEVBOX_API_BASE_URL` are also derived from the release namespace or platform cloud domain when left empty.

GitHub and prompt AI deployments install `sealos-deploy` from the production
`brain-deploy` source by default. To exercise another source in an environment,
set `ui.env.DEPLOY_SKILL_SOURCE`; for example, staging can use
`https://github.com/labring/sealos-skills/tree/brain-deploy-preview`. The skill
name and `/sealos-deploy` invocation do not change. The value is read by the UI
server process, so changing it requires a UI rollout and affects new deployment
runtimes; a Devbox where the skill is already installed is not overwritten.

Install or upgrade:

```bash
charts/brain-system/install.sh /tmp/brain-system.values.yaml
```

## Verify

Check rendered manifests:

```bash
helm template brain-system charts/brain-system \
  -n brain-system \
  -f /tmp/brain-system.values.yaml
```

Check rendered system labels:

```bash
helm template brain-system charts/brain-system \
  -n brain-system \
  -f /tmp/brain-system.values.yaml \
  | grep -E 'cloud.sealos.io/app-deploy-manager|app.kubernetes.io/instance|sealos-db-provider-cr'
```

Check live native resources after Helm install or upgrade:

```bash
kubectl -n brain-system get deploy,pod,svc,ingress,hpa,cluster -o wide
kubectl -n brain-system get deploy,svc,ingress -l app.kubernetes.io/instance=brain-system
kubectl -n brain-system get cluster -l sealos-db-provider-cr=brain-pg
kubectl -n brain-system rollout status deploy/whodb --timeout=5m
```

`brain-system` is a system stack, not a user project. The chart intentionally does not stamp Brain ownership labels on its resources.

## Operations

Durable system-stack changes should go through this Helm chart so resource names, platform labels, and generated URLs stay consistent.

For emergency inspection, read the native resources directly:

```bash
kubectl -n brain-system get deploy brain-api-staging -o yaml
kubectl -n brain-system get svc brain-api-staging-service -o yaml
kubectl -n brain-system get cluster brain-pg -o yaml
kubectl -n brain-system get svc brain-pg-export -o yaml
```

For deletion, prefer Helm release operations and then inspect leftover platform resources by the labels shown above.
