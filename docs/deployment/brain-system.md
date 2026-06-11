# brain-system Deployment Runbook

This runbook describes the current `brain-system` deployment model after AP/DB orchestration and AP public access support moved to direct Kubernetes and KubeBlocks resources.

## Architecture

`brain-system` is deployed through the Helm chart in `charts/brain-system`.

The chart renders:

- Brain direct AP manifests for `sealai-api-staging`, `sealai-ui-staging`, and `sealai-registry`.
- A Brain direct DB manifest for `brain-pg`.
- Native Kubernetes `Deployment` and `Service` for `whodb`.
- Optional application env `Secret` objects and image pull `Secret`.

The Brain Go API owns the AP/DB lifecycle. It accepts `apiVersion: brain.io/direct` product manifests, renders native Kubernetes/KubeBlocks resources plus AP public access support resources, applies them, and reads observed state back into AP/DB API views.

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

- `global.region`
- `projectId`
- `api.env.SEALOS_DESKTOP_URL`
- `ui.env.API_URL`
- `ui.env.DATABASE_URL`
- GitHub OAuth values
- assistant model values
- Devbox runtime values
- `imagePullSecret.create`

`api.env.SEALOS_DESKTOP_URL` is the Sealos Desktop base URL used to exchange the region token for a user kubeconfig.

Install or upgrade:

```bash
helm upgrade --install brain-system charts/brain-system \
  -n brain-system \
  --create-namespace \
  -f /tmp/brain-system.values.yaml
```

## First Database Install

The DB renderer creates a KubeBlocks Cluster named `brain-pg`. KubeBlocks generates the connection credential secret used to assemble `ui.env.DATABASE_URL`.

For a brand-new cluster, deploy without UI first:

```bash
helm upgrade --install brain-system charts/brain-system \
  -n brain-system \
  --create-namespace \
  -f /tmp/brain-system.values.yaml \
  --set ui.enabled=false

kubectl -n brain-system get secret brain-pg-conn-credential -o yaml
```

Fill `ui.env.DATABASE_URL`, then run the normal install command again without `--set ui.enabled=false`.

## Verify

Check the Brain product manifests:

```bash
helm template brain-system charts/brain-system \
  -n brain-system \
  -f /tmp/brain-system.values.yaml
```

Check rendered labels:

```bash
helm template brain-system charts/brain-system \
  -n brain-system \
  -f /tmp/brain-system.values.yaml \
  | grep -E 'brain.io/project-id|brain.io/managed-by|cloud.sealos.io/app-deploy-manager|app.kubernetes.io/instance'
```

Check live native resources after the Brain API has applied the product manifests:

```bash
kubectl -n brain-system get deploy,pod,svc,ingress,hpa,cluster -o wide
kubectl -n brain-system get deploy,svc,ingress,hpa -l brain.io/managed-by=brain
kubectl -n brain-system get cluster -l brain.io/resource-kind=db
kubectl -n brain-system rollout status deploy/whodb --timeout=5m
```

Project and canvas grouping are driven by `brain.io/project-id`. AP and DB resources for this stack should use the configured `projectId` value.

## Operations

Durable AP and DB changes should go through the Brain API product endpoints so rendered support resources, labels, status adapters, and cleanup behavior stay consistent.

For emergency inspection, read the native resources directly:

```bash
kubectl -n brain-system get deploy sealai-api-staging -o yaml
kubectl -n brain-system get svc sealai-api-staging-service -o yaml
kubectl -n brain-system get cluster brain-pg -o yaml
kubectl -n brain-system get svc brain-pg-export -o yaml
```

For deletion, prefer the Brain API. It deletes support resources by `brain.io/*` labels and then removes the AP workload or KubeBlocks Cluster.
