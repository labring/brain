# Adopt External Template Instances as Brain Projects

Sealos Skills (and any other apply path that is not Brain) can create a
Template Instance in Kubernetes without a Brain Project. Brain then cannot
list, group, or delete those resources, because Projects live in Postgres and
managed-resource selectors key on `brain.io/*` labels.

Brain's own GitHub Deployment Task path already stamps
`templateDeploymentExtraLabels` as Template API `extraLabels` at create time.
That path must not be routed through this adoption API.

## Decision

Add `POST /api/projects/adopt-template-instance`: a **claim-after-apply**
operation. The caller names an existing Instance; Brain creates one Project
and merge-patches Brain bookkeeping labels onto discovered namespaced
resources. Skills are unchanged. The GitHub extraLabels-at-create path stays
the create-time writer it already is.

**Claim-after-apply, not extraLabels-at-create.** extraLabels-at-create is
correct when Brain is the applier and already knows the Project ID. Skills
apply first and only then talk to Brain, so there is no Project ID to stamp
at create. Adoption is the inverse: discover what Sealos already created,
then claim it. Mixing the two would either double-write labels on Brain
deploys or leave Skills-created instances invisible.

**Namespace from kubeconfig only.** The body does not carry `namespace`. The
authorized namespace is the kubeconfig current-context namespace, then
verified. A body namespace would let a caller claim resources in a namespace
the kubeconfig does not actually grant.

**UID, not name, is identity.** Mapping is unique on `(namespace,
instance_uid)`. Instance names are reused when an Instance is deleted and
recreated; that new object is a new adoption and a new Project. Retrying the
same UID is idempotent: the same Project ID is reused and labeling is
re-run so children that appeared later still get claimed.

**Bookkeeping labels per ADR 0027.** Adoption writes the existing
`templateDeploymentExtraLabels` set (`brain.io/managed-by`,
`brain.io/project-id`, `brain.io/deployment-kind=template`,
`brain.io/deployment-name`, and `brain.io/template-name` when known). These
are ownership labels for cleanup and grouping. They must not be used to
decide whether a workload is an AP or a DB —
`brain.io/deployment-kind=template` is not a product classification.

Label patches touch `metadata.labels` only. Workload `spec.template` is left
alone; pod-template selectors stay Sealos-native. JSON merge-patch sends the
full labels map so Sealos-native keys are not wiped.

Project Display Names follow ADR 0058: an explicit name collides as 409; an
absent name is derived from the usable template name or the instance name.

## Considered Options

- **Route Brain's GitHub template deploy through this API instead of
  extraLabels.** Rejected. That path already knows the Project ID before
  apply; claiming afterwards would race children that appear after the
  Instance and would split one ownership writer into two.
- **Key the mapping on instance name.** Rejected. Recreating an Instance
  under the same name would steal or skip the previous Project.
- **Accept namespace in the JSON body (as `POST /api/projects` does).**
  Rejected. This handler mutates cluster state; the only namespace it may
  touch is the one the kubeconfig authorizes.
- **Classify adopted APs/DBs from `brain.io/deployment-kind=template`.**
  Rejected by ADR 0027. Product identity stays on Sealos Launchpad and
  KubeBlocks labels.

## Consequences

Explorer and `GET /api/projects` are unchanged: there is no user-visible
Project adoption status. Mapping status (`adopting` / `adopted` / `failed`)
is internal. A failed label pass keeps the Project ID so retry cannot create
a second Project. Resources already labeled with a different
`brain.io/project-id` are a conflict, not an overwrite.
