# Use Sealos Native Product Labels for Template Instances

## Status

Accepted.

This ADR replaces the previous deployment-scoped Brain label model. The old
model made `brain.io/deployment-kind=template` part of AP/DB discovery by
classifying template-produced native resources from their Kubernetes kind and
relationships. That direction is no longer accepted.

## Context

Brain has three deployment entry paths:

- Direct AP deployment.
- Direct DB deployment.
- Template deployment.

A template deployment creates one Sealos `Instance`. That instance can contain
standard Launchpad AP resources, standard DB Provider/KubeBlocks resources, and
support resources such as Services, Ingresses, Secrets, ConfigMaps, PVCs, and
Certificates.

The product identity must not be inferred from Brain's template ownership
labels. A template does not produce a special product type. It produces normal
AP and DB resources grouped by one template instance.

## Decision

Template is an instance/composition boundary. AP and DB identity must use the
mature Sealos labels that their owning product controllers already use.

The required model is:

```text
Template Instance
  -> standard AP resources identified by Launchpad labels
  -> standard DB resources identified by DB Provider/KubeBlocks labels
  -> support resources linked by the same product labels
```

Brain may keep Brain-specific ownership labels for cleanup, UI grouping, and
internal bookkeeping, but Brain labels are not product classification labels.

## Required Labels

### Template Instance Boundary

Every resource rendered from a template instance must carry:

```text
cloud.sealos.io/deploy-on-sealos=<instanceName>
```

This label means "belongs to this template instance". It does not mean AP, DB,
or public access.

Brain may also write:

```text
brain.io/managed-by=brain
brain.io/project-id=<instanceName-or-projectId>
brain.io/deployment-name=<instanceName>
brain.io/template-name=<templateName>
```

These labels are Brain ownership and bookkeeping labels only.

### AP Identity

Every AP workload produced by any path, including templates, must carry:

```text
cloud.sealos.io/app-deploy-manager=<appName>
app=<appName>
```

The AP workload is the Deployment or StatefulSet selected by
`cloud.sealos.io/app-deploy-manager=<appName>`.

AP support resources must also carry:

```text
cloud.sealos.io/app-deploy-manager=<appName>
```

Pod selectors and Service selectors must continue to use:

```text
app=<appName>
```

### AP Public Access

Ingress and public routing support resources for an AP must carry:

```text
cloud.sealos.io/app-deploy-manager=<appName>
cloud.sealos.io/app-deploy-manager-domain=<domainKey>
```

Long hostnames must not be stored directly in label values. Store long host
values in annotations when needed.

### DB Identity

Every DB instance produced by any path, including templates, must carry DB
Provider/KubeBlocks identity labels:

```text
app.kubernetes.io/instance=<dbName>
clusterdefinition.kubeblocks.io/name=<engine>
clusterversion.kubeblocks.io/name=<version>
```

The KubeBlocks `Cluster` is the DB product root. DB support resources must be
linked by `app.kubernetes.io/instance=<dbName>` when the resource belongs to
that DB.

## Query Rules

AP list/read must discover APs by Launchpad labels:

```text
cloud.sealos.io/app-deploy-manager
```

When listing APs for a template instance, append:

```text
cloud.sealos.io/deploy-on-sealos=<instanceName>
```

DB list/read must discover DBs by DB Provider/KubeBlocks labels:

```text
app.kubernetes.io/instance
clusterdefinition.kubeblocks.io/name
```

When listing DBs for a template instance, append:

```text
cloud.sealos.io/deploy-on-sealos=<instanceName>
```

Brain product APIs must not use `brain.io/deployment-kind=template` to decide
whether a workload is an AP or DB.

## Rendering Rules

Direct AP rendering must write the AP identity labels and AP support labels.

Direct DB rendering must write the DB identity labels and DB support labels.

Template rendering must normalize rendered resources before apply:

- Deployment and StatefulSet resources that represent APs must receive AP
  identity labels.
- Their pod templates must receive `app=<appName>`.
- Services for APs must select `app=<appName>` and carry
  `cloud.sealos.io/app-deploy-manager=<appName>`.
- Ingresses for APs must carry AP identity and domain labels.
- KubeBlocks Clusters that represent DBs must receive DB identity labels.
- DB support resources must carry `app.kubernetes.io/instance=<dbName>`.
- All template-rendered namespaced resources must carry
  `cloud.sealos.io/deploy-on-sealos=<instanceName>`.

If a rendered resource cannot be normalized into a standard AP or DB, it remains
a support resource for the template instance. It must not be projected as AP or
DB by kind inference.

## Lifecycle Rules

AP lifecycle operations may operate only on resources identified as AP by
Launchpad AP labels.

DB lifecycle operations may operate only on resources identified as DB by DB
Provider/KubeBlocks labels.

Template lifecycle operations may operate on the whole instance scope selected
by:

```text
cloud.sealos.io/deploy-on-sealos=<instanceName>
```

Deleting a template instance deletes the instance scope. Deleting an AP deletes
only the AP and AP support resources. Deleting a DB deletes only the DB and DB
support resources.

## Prohibited Patterns

Do not use these rules in new code:

```text
brain.io/deployment-kind=template => AP-like workload
brain.io/deployment-kind=template => DB-like workload
Deployment or StatefulSet => AP
KubeBlocks Cluster => DB
TemplateNative => user-visible resource type
```

`TemplateNative` may exist only as an internal transient implementation detail
during removal work. It must not be part of the product model, API contract,
label contract, or user-visible canvas model.

## Removed Contract

The following labels are not product identity labels and must not be used for
AP/DB discovery:

```text
brain.io/deployment-kind
brain.io/resource-kind
brain.io/app-name
brain.io/db-name
brain.io/resource-name
```

They may be removed or retained only as Brain bookkeeping labels. They do not
define product type.

## Compatibility

There is no backward-compatibility requirement for the old template inference
model.

Existing template resources that do not carry the new Sealos native labels are
allowed to become invisible to AP/DB product queries and lifecycle operations.
They must be redeployed or explicitly relabeled if a project needs to keep
managing them.

## Consequences

The read layer becomes simpler and more stable: AP and DB discovery use the same
labels as Sealos Launchpad and DB Provider.

Template rendering becomes responsible for producing valid standard AP and DB
resources. If rendering omits the required labels, that is a render/apply bug,
not a query-layer fallback case.

Canvas should render template-produced APs and DBs through the normal AP and DB
resource paths. It should not render template workloads through a separate
TemplateNative product path.

## Verification Requirements

Before this ADR is considered implemented:

- A template that produces an AP must make that AP visible through the normal AP
  list API.
- A template that produces a DB must make that DB visible through the normal DB
  list API.
- A template AP must support AP lifecycle operations through the normal AP
  lifecycle API.
- A template DB must support DB lifecycle operations through the normal DB
  lifecycle API.
- Canvas must show template APs and DBs as normal AP and DB nodes.
- Canvas must not show a user-visible TemplateNative node.
- Tests must reject `brain.io/deployment-kind=template` as an AP/DB discovery
  mechanism.
