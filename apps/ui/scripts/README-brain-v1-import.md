# Brain v1 Import Script

`brain-v1-import.mjs` migrates Brain v1 Kubernetes resources into the Brain v2 project model.

The script is intentionally explicit:

- `inventory` reads Kubernetes and writes `inventory.json` for manual review.
- `dry-run` reads Kubernetes and writes `migration.sql` plus `migration-manifest.json`.
- `apply` inserts v2 project rows and patches selected Kubernetes resources with `brain.io/*` labels.
- `rollback` uses the manifest to remove the labels added by this migration and delete inserted project rows.

## Usage

```bash
cd apps/ui

bun scripts/brain-v1-import.mjs inventory \
  --kubeconfig /path/to/kubeconfig \
  --context <context> \
  --out .migration/brain-v1-all-namespaces

bun scripts/brain-v1-import.mjs dry-run \
  --inventory .migration/brain-v1-all-namespaces/inventory.json \
  --out .migration/brain-v1-all-namespaces
```

Omit `--namespace` to scan every namespace visible to the kubeconfig/context. Add `--namespace <namespace>` when you want to limit the scan to one namespace.

You can also skip the separate inventory file and let `dry-run` scan Kubernetes directly:

```bash
bun scripts/brain-v1-import.mjs dry-run \
  --kubeconfig /path/to/kubeconfig \
  --context <context> \
  --out .migration/brain-v1-all-namespaces
```

After reviewing the generated SQL and manifest:

```bash
bun scripts/brain-v1-import.mjs apply \
  --manifest .migration/brain-v1-all-namespaces/migration-manifest.json \
  --database-url "$DATABASE_URL" \
  --yes

bun scripts/brain-v1-import.mjs rollback \
  --manifest .migration/brain-v1-all-namespaces/migration-manifest.json \
  --database-url "$DATABASE_URL" \
  --yes
```

`apply` and `rollback` require `--yes` or `BRAIN_V1_IMPORT_YES=1`.

## Inventory Resume

`inventory` is resumable. It writes:

```text
.migration/brain-v1-all-namespaces/inventory-progress.json
.migration/brain-v1-all-namespaces/inventory.json
```

If a transient Kubernetes request fails, re-run the same `inventory` command. Completed v1 `Instance` scans are reused from `inventory-progress.json`, and failed instances are retried.

Only continue to `dry-run` when:

```bash
jq '.summary.errors' .migration/brain-v1-all-namespaces/inventory.json
```

returns `0`. `dry-run` rejects inventories with unresolved `errors`.

## Safety Model

The script does not delete v1 labels such as:

```text
cloud.sealos.io/deploy-on-sealos
cloud.sealos.io/app-deploy-manager
```

It only adds or removes the `brain.io/*` labels recorded in the manifest.

One v1 `Instance` maps to one v2 project row. Individual Kubernetes resources are patched with labels; they do not create separate project rows.
