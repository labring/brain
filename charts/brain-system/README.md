# brain-system Helm Chart

This chart is the preferred entrypoint for deploying the `brain-system` stack.

It renders:

- native Kubernetes `Deployment`, `Service`, and `Ingress` resources for `sealai-api-staging`, `sealai-ui-staging`, and `sealai-registry`
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

- `global.region`
- `api.env.SEALOS_DESKTOP_URL`
- `api.env.VLSELECT_*` or `api.env.VMAUTH_SECRET_*` if VictoriaLogs requires authentication
- GitHub App values (`GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`)
- assistant model values (`SYSTEM_OPENAI_*`, `FREE_CHAT_TURNS`, `AI_PROXY_TOKEN_NAME`)
- Devbox runtime values (`DEVBOX_API_BASE_URL`, `DEVBOX_TOKEN` or `DEVBOX_JWT_SIGNING_KEY`)
- `imagePullSecret.create`: keep `true` when the chart should create and reference `ghcr-cred`

`api.env.SEALOS_DESKTOP_URL` is the Sealos Desktop base URL used to exchange the region token for a user kubeconfig.

When left empty, `ui.env.API_URL` and `ui.env.NEXT_PUBLIC_APP_URL` are derived from the API/UI Ingress hosts rendered by this chart.

`ui.env.DATABASE_URL` and `api.env.DATABASE_URL` are derived from the chart-created `brain-pg-conn-credential` Secret when left empty.

Install or upgrade:

```bash
helm upgrade --install brain-system charts/brain-system \
  -n brain-system \
  --create-namespace \
  -f /tmp/brain-system.values.yaml
```

## Database Credentials

The chart creates a KubeBlocks Cluster named `brain-pg`. KubeBlocks generates `brain-pg-conn-credential`, and the app Deployments reference that Secret to assemble `DATABASE_URL` at runtime.

Application environment variables are rendered directly into the app Deployments. The chart only creates a Kubernetes Secret for image pull credentials, because app env Secrets do not provide encryption by themselves and add little value here.

## Verify

```bash
kubectl -n brain-system get deploy,pod,svc,ingress,hpa,cluster -o wide
kubectl -n brain-system rollout status deploy/whodb --timeout=5m
```

For Brain-managed resources:

```bash
kubectl -n brain-system get deploy,svc,ingress,hpa -l brain.io/managed-by=brain
kubectl -n brain-system get cluster -l brain.io/resource-kind=db
```
