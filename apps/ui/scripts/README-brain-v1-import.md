# Brain v1 Import Script

`brain-v1-import.mjs` migrates Brain v1 Kubernetes resources into the Brain v2 project model.

The script is intentionally explicit:

- `snapshot` uses the explicit kubeconfig in-process, opens no local proxy/listening port, and writes a resumable local snapshot from enumerated collection GETs.
- `inventory` reads only the completed local snapshot and writes `inventory.json` plus `classification-report.json`.
- `dry-run` reads only `inventory.json` and writes `migration.sql` plus `migration-manifest.json`.
- `apply` inserts v2 project rows and patches selected Kubernetes resources with `brain.io/*` labels.
- `rollback` uses the manifest to remove the labels added by this migration and delete inserted project rows.

## Usage

```bash
cd apps/ui

bun scripts/brain-v1-import.mjs snapshot \
  --kubeconfig /path/to/kubeconfig \
  --context <context> \
  --out .migration/brain-v1-all-namespaces

bun scripts/brain-v1-import.mjs inventory \
  --snapshot .migration/brain-v1-all-namespaces/snapshot-v1 \
  --out .migration/brain-v1-all-namespaces

bun scripts/brain-v1-import.mjs dry-run \
  --inventory .migration/brain-v1-all-namespaces/inventory.json \
  --out .migration/brain-v1-all-namespaces
```

Omit `--namespace` from `snapshot` to scan every namespace visible to the kubeconfig/context. Add `--namespace <namespace>` to limit the snapshot to one namespace. `inventory` rejects kubeconfig, context, and namespace flags; `dry-run` requires an explicit local inventory file.

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

`apply` and `rollback` accept only the new `brain-v1-migration/v2` manifest. A legacy manifest has no source fingerprint and is rejected rather than risking writes to an unverified cluster.

Both commands recompute the local kubeconfig/context source fingerprint before opening a database connection or patching resources. If that source no longer matches the snapshot used to build the inventory and manifest, the command stops. The verified configuration and any referenced certificate/key files are frozen in memory and supplied to `kubectl` through standard input, so no credential-bearing temporary kubeconfig is written.

## Snapshot Resume and Local Files

`snapshot` writes normalized NDJSON files instead of retaining the complete cluster result in memory:

```text
.migration/brain-v1-all-namespaces/snapshot-v1/snapshot-manifest.json
.migration/brain-v1-all-namespaces/snapshot-v1/resources/*.ndjson
```

Re-running the exact same `snapshot` command verifies checksums and reuses completed resource files. An expired Kubernetes pagination token restarts only the current resource type. A changed context, kubeconfig, namespace, or page size is rejected instead of mixing snapshots.

`inventory` then creates:

```text
.migration/brain-v1-all-namespaces/snapshot-v1/index.sqlite
.migration/brain-v1-all-namespaces/inventory.json
.migration/brain-v1-all-namespaces/classification-report.json
```

The SQLite index is a local, disposable acceleration index. It is rebuilt from verified snapshot files and is not a database used by the product.

Only continue to `dry-run` when:

```bash
jq '.summary.errors' .migration/brain-v1-all-namespaces/inventory.json
jq '.summary.manualReview' .migration/brain-v1-all-namespaces/classification-report.json
```

both return `0`. `dry-run` rejects unresolved inventory errors or manual-review projects.

When `manualReview` is non-zero—or when an eligible project is not needed—create a separate decisions file. Decisions must match both the `projectId` and `classificationHash` shown in `classification-report.json`:

```json
{
  "schema": "brain-v1-classification-decisions/v1",
  "version": 1,
  "decisions": [
    {
      "projectId": "<project-id-from-classification-report>",
      "classificationHash": "<classification-hash-from-classification-report>",
      "decision": "include",
      "note": "reviewed by migration owner"
    }
  ]
}
```

Use `include` to migrate the Template Instance while leaving unsupported member resources untouched, or `exclude` to omit any candidate, including an otherwise eligible AP/DB project. The classification hash invalidates stale decisions after the resource shape changes. Then rebuild the local inventory:

```bash
bun scripts/brain-v1-import.mjs inventory \
  --snapshot .migration/brain-v1-all-namespaces/snapshot-v1 \
  --decisions .migration/brain-v1-all-namespaces/classification-decisions.json \
  --out .migration/brain-v1-all-namespaces
```

Legacy v1 inventory files are deliberately rejected. Only `brain-v1-inventory/v2` produced from a verified snapshot can enter `dry-run`.

## Safety Model

The script does not delete v1 labels such as:

```text
cloud.sealos.io/deploy-on-sealos
cloud.sealos.io/app-deploy-manager
```

It only adds or removes the `brain.io/*` labels recorded in the manifest.

The snapshot phase opens no local listening port and issues only API discovery plus enumerated Kubernetes collection `GET` requests. It validates configured API group versions before capture. Secrets use Kubernetes `PartialObjectMetadataList`; if metadata-only negotiation is not honored, the snapshot fails without writing Secret contents.

One eligible v1 `Instance` maps to one v2 project row. The migration does not query or migrate Devbox resources. The Template Instance remains the ownership anchor; AP workloads and DB Clusters determine whether the project has resources supported by Brain v2.

Classification is explicit:

- `eligible`: contains an AP Deployment/StatefulSet with `cloud.sealos.io/app-deploy-manager`, or a KubeBlocks Cluster.
- `excluded`: has no v2-supported member, including an exact App-CRD-only shape.
- `manual-review`: has unsupported members such as ConfigMap-only or object-storage-only. AP/DB plus any unsupported member remains eligible but is highlighted in `eligibleWithReview`.

If multiple importable Instances in the same namespace have the same display name, `dry-run` keeps the first name and appends the legacy Instance name to later duplicates, for example `N8N (n8n-example)`. The final value is used only for the v2 Project `display_name`; resource ownership still uses `brain.io/project-id`.
