# brain-system deploy config

This directory contains the raw declarative resources for the `brain-system` namespace.

The preferred deployment entrypoint is now the Helm chart:

```bash
helm upgrade --install brain-system charts/brain-system \
  -n brain-system \
  --create-namespace \
  -f /tmp/brain-system.values.yaml
```

Use this directory as a raw-manifest reference when debugging.

## Apply order

1. Install platform controllers and add-ons: KubeBlocks, ingress-nginx, cert-manager when custom domains are used, VictoriaMetrics, and VictoriaLogs.
2. Deploy the application stack through `charts/brain-system`.

## Raw manifest fallback

If Helm is not available, create real secrets from local values. The files under `secrets/*.example.yaml` are examples only and are not referenced by `kustomization.yaml`.

Then apply the namespace, Brain direct DB/AP manifests, and WhoDB resources:

   ```bash
   kubectl apply -k deploy/brain-system
   ```

Verify:

   ```bash
kubectl -n brain-system get deploy,pod,svc,ingress,hpa,cluster -o wide
kubectl -n brain-system get deploy,svc,ingress,hpa -l brain.io/managed-by=brain
   ```

For the full runbook, see `docs/deployment/brain-system.md`.
