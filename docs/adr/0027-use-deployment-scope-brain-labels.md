# Use Deployment-Scoped Brain Labels

## Status

Accepted.

## Context

Brain renders direct AP and DB resources itself, but template deployments are
sent to the Sealos template provider with one global `extraLabels` map. The
provider applies that same map to every rendered object in the template result.
A single template deployment can contain a StatefulSet or Deployment, a
KubeBlocks Cluster, Services, Ingresses, Secrets, PVCs, and other support
objects.

The previous label model used `brain.io/resource-kind` for two different
concepts:

- Product/resource classification: `ap`, `db`, `public-access-support`.
- Deployment source classification: `template`.

That made template resources require special AP/DB selectors, and it prevented
template-owned Ingresses from being consistently projected as AP Public Access.
It also made it unsafe to solve template support by setting
`brain.io/resource-kind=ap`, `db`, or `public-access` through template
`extraLabels`, because every rendered object would receive the same product
classification.

## Decision

Brain-managed Kubernetes resources use deployment-scoped labels. These labels
describe which Brain deployment produced the object. They do not claim the
object's product type.

All Brain-managed objects must carry:

```text
brain.io/managed-by=brain
brain.io/project-id=<projectId>
brain.io/deployment-kind=<ap | db | template>
brain.io/deployment-name=<apName | dbName | templateInstanceName>
```

Template deployments must also carry:

```text
brain.io/template-name=<templateName>
```

Direct AP resources use:

```text
brain.io/managed-by=brain
brain.io/project-id=<projectId>
brain.io/deployment-kind=ap
brain.io/deployment-name=<apName>
```

Direct DB resources use:

```text
brain.io/managed-by=brain
brain.io/project-id=<projectId>
brain.io/deployment-kind=db
brain.io/deployment-name=<dbName>
```

Template resources use the same labels on every rendered object:

```text
brain.io/managed-by=brain
brain.io/project-id=<projectId>
brain.io/deployment-kind=template
brain.io/deployment-name=<templateInstanceName>
brain.io/template-name=<templateName>
```

Brain product views classify resources by Kubernetes kind and resource
relationships inside a deployment scope:

- Deployment or StatefulSet becomes an AP-like workload.
- KubeBlocks Cluster becomes a DB-like workload.
- Ingress becomes AP Public Access evidence.
- Service is support evidence and can connect Ingress backends to workloads.

AP Public Access is still an AP-derived product view. It is not a standalone
Brain deployment and does not require a separate `deployment-kind` value.

## Query Rules

Direct AP list/read scopes by:

```text
brain.io/managed-by=brain,
brain.io/deployment-kind=ap
```

Direct DB list/read scopes by:

```text
brain.io/managed-by=brain,
brain.io/deployment-kind=db
```

Template resource discovery scopes by:

```text
brain.io/managed-by=brain,
brain.io/project-id=<projectId>,
brain.io/deployment-kind=template
```

Within a template deployment scope, AP/DB/Public Access projection must inspect
the object kind and relationships instead of trusting a product-kind label.

AP Public Access for direct AP resources can use the direct AP deployment
labels. AP Public Access for template resources must be linked through
Ingress -> Service -> workload relationships, or through provider labels only
as secondary evidence when the relationship is unambiguous.

## Removed Brain Ownership Labels

The following labels are no longer part of the Brain ownership contract:

```text
brain.io/resource-kind
brain.io/resource-name
brain.io/app-name
brain.io/db-name
```

External controller labels are not Brain ownership labels and may remain when
needed by Kubernetes controllers or Sealos/KubeBlocks integration. Examples:

```text
app
cloud.sealos.io/app-deploy-manager
cloud.sealos.io/app-deploy-manager-domain
app.kubernetes.io/instance
clusterdefinition.kubeblocks.io/name
clusterversion.kubeblocks.io/name
```

## Consequences

This is an incompatible label contract change. Existing resources that only
carry the old Brain ownership labels are not required to remain visible or
mutable. They should be redeployed or relabeled by an explicit migration if a
project needs to preserve them.

The read layer becomes responsible for product classification. That is
intentional: template labels cannot safely express per-object product types.

The AP and DB create, update, delete, and support-resource cleanup paths must
all use deployment-scoped labels consistently. Partial adoption is unsafe
because resources created under the new contract would fail old ownership
checks or cleanup selectors.
