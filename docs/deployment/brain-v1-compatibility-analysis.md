# Brain v1 Resource Compatibility Analysis

Date: 2026-06-29

## Conclusion

Brain v1 projects are not identifiable by the current Brain v2 label contract. v1 uses Sealos-native ownership labels:

- Project identity: `app.sealos.io/v1` `Instance`
- Project membership: `cloud.sealos.io/deploy-on-sealos=<projectName>`
- Launchpad/AP grouping: `cloud.sealos.io/app-deploy-manager=<appName>`
- DevBox public access grouping: `cloud.sealos.io/devbox-manager=<devboxName>`
- DevBox release-to-app trace: `cloud.sealos.io/app-devbox-id=<devboxId>` on the generated Deployment

Current Brain v2 requires `brain.io/managed-by=brain` and `brain.io/project-id` for AP discovery and lifecycle ownership. Therefore, v1-created or v1-associated resources will be invisible to v2 AP/project queries unless we add a deliberate legacy import/discovery path.

The safe compatibility model is:

1. Discover legacy v1 projects from `app.sealos.io/v1` `Instance` resources.
2. Discover legacy project members by `cloud.sealos.io/deploy-on-sealos=<projectName>`.
3. Treat legacy AP-like workloads as imported/readonly until explicit backfill attaches Brain v2 ownership labels.
4. Keep destructive lifecycle operations gated by Brain v2 labels or an explicit import state.

## Evidence Sources

v1 source:

- Repository: `https://github.com/aimeritething/brain`
- Branch: `might`
- Commit: `ebfba4df2e4f254952da7cfea4c9d8acafb5a5f0`
- Local checkout used for analysis: `/tmp/aimeritething-brain-v1`

v2 source:

- Repository checkout: `/Users/jingyang/work/brain`
- Current working tree was dirty before this document was added; this analysis did not modify existing code.

## v1 Resource Model

### Project

v1 project creation creates an `app.sealos.io/v1` `Instance`.

Evidence:

- `/tmp/aimeritething-brain-v1/src/lib/sealos/resources/instance/instance-method/instance-utils.ts`
- `/tmp/aimeritething-brain-v1/src/lib/brain/resources/project/project-api/project-api-service.ts`

The generated Instance shape is:

```yaml
apiVersion: app.sealos.io/v1
kind: Instance
metadata:
  name: <projectName>
  namespace: <namespace>
  labels:
    cloud.sealos.io/deploy-on-sealos: <projectName>
spec:
  templateType: inline
  defaults:
    app_name:
      type: string
      value: <projectName>
  title: <projectName>
```

Display name is stored separately on the Instance annotation:

```text
cloud.sealos.io/deploy-on-sealos-displayName
```

There is no `brain.io/project-id` in v1.

### Project Membership

v1 adds resources to a project by patching the resource metadata label:

```text
cloud.sealos.io/deploy-on-sealos=<projectName>
```

Evidence:

- `/tmp/aimeritething-brain-v1/src/lib/brain/resources/project/project-method/project-mutation.ts`
- `/tmp/aimeritething-brain-v1/src/lib/brain/resources/project/project-api/project-api-service.ts`
- `/tmp/aimeritething-brain-v1/src/lib/sealos/resources/instance/instance-method/instance-query.ts`

v1 removes a resource from a project by removing that same label. Project resource listing uses this selector:

```text
cloud.sealos.io/deploy-on-sealos=<projectName>
```

The resource types considered project members include:

- Builtin: `deployment`, `statefulset`, `configmap`
- Custom: `devbox`, `cluster`, `objectstoragebucket`, `app`

The v1 project membership label is a mutable grouping label, not a stable UUID. It can collide if two project Instances with the same name exist in different namespaces, but inside one namespace it is the effective project boundary.

### Launchpad / AP-Like Workloads

v1 can create direct Launchpad-style resources. Both `deployment/deploy-utils.ts` and `launchpad-api-utils.ts` generate the same label shape.

Deployment:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: <appName>
  annotations:
    originImageName: <image>
    deploy.cloud.sealos.io/minReplicas: "1"
    deploy.cloud.sealos.io/maxReplicas: "1"
    deploy.cloud.sealos.io/resize: "0Gi"
  labels:
    cloud.sealos.io/app-deploy-manager: <appName>
    app: <appName>
spec:
  selector:
    matchLabels:
      app: <appName>
  template:
    metadata:
      labels:
        app: <appName>
        restartTime: <timestamp>
```

Service:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: <appName>
  labels:
    cloud.sealos.io/app-deploy-manager: <appName>
spec:
  selector:
    app: <appName>
```

Ingress:

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: network-<random>
  labels:
    cloud.sealos.io/app-deploy-manager: <appName>
    cloud.sealos.io/app-deploy-manager-domain: <domainId>
```

Again, there are no Brain v2 labels:

- no `brain.io/managed-by`
- no `brain.io/project-id`
- no `brain.io/deployment-kind`
- no `brain.io/deployment-name`

### DevBox

v1 DevBox creation is based on the DevBox CRD and related Service/Ingress resources.

Evidence:

- `/tmp/aimeritething-brain-v1/src/lib/sealos/resources/devbox/devbox-constant/devbox-constant-resource.ts`

DevBox CR:

```yaml
apiVersion: devbox.sealos.io/v1alpha1
kind: Devbox
metadata:
  name: <devboxName>
spec:
  network:
    type: NodePort
```

DevBox Service:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: <devboxName>
  labels:
    cloud.sealos.io/devbox-manager: <devboxName>
spec:
  selector:
    app.kubernetes.io/name: <devboxName>
    app.kubernetes.io/part-of: devbox
    app.kubernetes.io/managed-by: sealos
```

DevBox Ingress:

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: <devboxName>-<random>
  labels:
    cloud.sealos.io/devbox-manager: <devboxName>
    cloud.sealos.io/app-deploy-manager-domain: <domain>.<regionHost>
```

### DevBox Release Deployment

v1 does not render the DevBox release Deployment itself. It calls the DevBox service:

```text
POST https://devbox.<region>/api/deployDevbox
```

Evidence:

- `/tmp/aimeritething-brain-v1/src/lib/sealos/resources/devbox/devbox-api/devbox-open-api.ts`
- `/tmp/aimeritething-brain-v1/src/hooks/sealos/devbox/use-devbox-deploy.ts`

The API returns:

```ts
{
  data: {
    message: string;
    appName: string;
    publicDomains: { host: string; port: number }[];
  }
}
```

v1 then converts `data.appName` into a Deployment target and adds it to the selected project by patching:

```text
cloud.sealos.io/deploy-on-sealos=<projectName>
```

Runtime `usw` samples show the DevBox service-created Deployment additionally carries:

```text
cloud.sealos.io/app-devbox-id=<devboxId>
```

This label is not defined by v1 Brain source; it is produced by the external DevBox service.

## Current v2 Label Model

Current Brain v2 label constants are defined in:

- `/Users/jingyang/work/brain/apps/api/service/orchestration/labels.go`
- `/Users/jingyang/work/brain/apps/ui/src/lib/brain-labels.ts`

Core Brain v2 labels:

```text
brain.io/managed-by=brain
brain.io/project-id=<projectId>
brain.io/deployment-kind=<ap|db|template>
brain.io/deployment-name=<deploymentName>
brain.io/template-name=<templateName>
```

Launchpad compatibility labels retained in v2:

```text
cloud.sealos.io/app-deploy-manager=<apName>
cloud.sealos.io/app-deploy-manager-domain=<domainLabel>
app=<apName>
```

For direct AP rendering, v2 merges Brain labels with Launchpad labels:

```go
brainLabels(projectID, DeploymentKindAP, name)
LaunchpadAppDeployManagerLabel: name
LaunchpadAppLabel: name
```

For template deployment, v2 injects:

```ts
brain.io/managed-by=brain
brain.io/project-id=<projectId>
brain.io/deployment-kind=template
brain.io/deployment-name=<instanceName>
brain.io/template-name=<templateName>
```

## Current Incompatibility

### AP List

Current AP list selector is:

```text
cloud.sealos.io/app-deploy-manager,
brain.io/managed-by=brain,
brain.io/project-id
```

Source:

- `/Users/jingyang/work/brain/apps/api/route/ap/workload.go`

This excludes v1 AP-like resources, because v1 only guarantees:

```text
cloud.sealos.io/app-deploy-manager=<appName>
```

If the v1 resource was added to a v1 project, it may also have:

```text
cloud.sealos.io/deploy-on-sealos=<projectName>
```

But it still does not have `brain.io/project-id`.

### AP Get / Lifecycle

Current single AP resolution calls `requireLaunchpadAPDeployment` / `requireLaunchpadAPStatefulSet`, which also require:

```text
brain.io/managed-by=brain
brain.io/project-id
```

So even if the workload name is known, a v1 Deployment or StatefulSet will not be treated as a Brain AP by v2.

### Public Access Support Resources

`apSupportResourceAPName()` can group support resources by `cloud.sealos.io/app-deploy-manager` with fallback to `brain.io/deployment-name`, but the support-resource listing selector still requires:

```text
cloud.sealos.io/app-deploy-manager,
brain.io/managed-by=brain,
brain.io/project-id
```

Therefore the fallback is not enough to discover pure v1 resources.

### Project Identity

v1 project identity is an `Instance` name. v2 project identity is `projectId` stored in Brain-owned labels and database state. These are not equivalent:

- v1: `cloud.sealos.io/deploy-on-sealos=<projectName>`
- v2: `brain.io/project-id=<projectId>`

Any automatic compatibility layer must decide how to map a legacy Instance name to a v2 project id.

## Production `usw` Findings

### Brain v1 Service

Observed in `brain-system`:

```text
Deployment/sealos-brain-frontend image=puddlecat/sealos-brain-ui:20260520.1
Deployment/sealos-brain-ai       image=puddlecat/sealos-brain-ai:20260520.8
```

These production deployments are about 39 days old at analysis time. The frontend labels are Launchpad-style:

```text
app=sealos-brain-frontend
app.kubernetes.io/name=brain
app.kubernetes.io/part-of=sealos-brain
cloud.sealos.io/app-deploy-manager=sealos-brain-frontend
```

### Absence of Brain v2 Labels

Read-only queries against `usw` found no common workload/support resources under:

```text
brain.io/managed-by=brain
brain.io/deployment-name
```

This matches the v1 code: v1 does not define or apply `brain.io/*` labels.

### DevBox Release Samples

`usw` has many Deployments with:

```text
cloud.sealos.io/app-deploy-manager=<releaseAppName>
cloud.sealos.io/app-devbox-id=<devboxId>
app=<releaseAppName>
```

Examples observed:

```text
ns-1kdf9wsf Deployment/devbox-release-gvpbnl
  app=devbox-release-gvpbnl
  cloud.sealos.io/app-deploy-manager=devbox-release-gvpbnl
  cloud.sealos.io/app-devbox-id=0f993d4c-dc20-414b-8ee3-b2971be81328

ns-1kdf9wsf Deployment/todolist2-release-srrohr
  app=todolist2-release-srrohr
  cloud.sealos.io/app-deploy-manager=todolist2-release-srrohr
  cloud.sealos.io/app-devbox-id=0059df5f-2c7b-4eac-9379-0654ede98775
```

Their Services and Ingresses use only Launchpad labels:

```text
Service/todolist2-release-srrohr
  cloud.sealos.io/app-deploy-manager=todolist2-release-srrohr

Ingress/network-qfwqybrwllnp
  cloud.sealos.io/app-deploy-manager=todolist2-release-srrohr
  cloud.sealos.io/app-deploy-manager-domain=xohzrviysuwa
```

### Important Limitation

Production DB tables in `brain-system` did not provide a reliable v1 project index:

- `sealai_project.project_canvas_layouts` existed but had 0 rows.
- `sealai_assistant.assistant_chats` did not return namespace samples in the query run.

So K8s labels and `Instance` resources are the reliable source of truth for legacy compatibility.

## Compatibility Design

### Read Path

Add a legacy project read path that works per namespace:

1. List v1 project Instances:

   ```text
   app.sealos.io/v1 Instance
   ```

2. For each Instance `<projectName>`, list related resources by:

   ```text
   cloud.sealos.io/deploy-on-sealos=<projectName>
   ```

3. For AP-like display, include Deployment/StatefulSet resources that have:

   ```text
   cloud.sealos.io/app-deploy-manager
   ```

4. Join support resources by:

   ```text
   cloud.sealos.io/app-deploy-manager=<appName>
   ```

5. Mark these resources as:

   ```text
   origin=legacy-v1
   ownership=legacy-project-label
   writable=false
   ```

This avoids pretending v1 resources are fully Brain-owned v2 APs.

### Import / Backfill Path

To make a v1 project writable in v2, run an explicit import/backfill operation.

For each legacy project:

1. Create or resolve a v2 project id.
2. Patch the project Instance or store a mapping:

   ```text
   legacyProjectName -> v2ProjectId
   ```

3. Patch each imported workload and its support resources with:

   ```text
   brain.io/managed-by=brain
   brain.io/project-id=<v2ProjectId>
   brain.io/deployment-kind=<ap|template|db>
   brain.io/deployment-name=<deploymentName>
   ```

4. Keep existing Sealos labels unchanged:

   ```text
   cloud.sealos.io/deploy-on-sealos=<legacyProjectName>
   cloud.sealos.io/app-deploy-manager=<appName>
   cloud.sealos.io/app-devbox-id=<devboxId>
   ```

Do not remove v1 labels during import. Launchpad, DevBox, and existing Sealos UI behavior may still depend on them.

### Write Path

Before import:

- Allow list/detail/log/metrics/public URL display where selectors can be resolved from legacy labels.
- Block delete, restart, stop/start, routing mutation, storage mutation, and env mutation from the v2 AP API unless the operation delegates to the original Sealos API with legacy semantics and has an explicit product decision.

After import:

- v2 AP lifecycle can operate using Brain labels.
- The operation should still preserve `cloud.sealos.io/app-deploy-manager` and `cloud.sealos.io/deploy-on-sealos`.

## Risks

### False Ownership

`cloud.sealos.io/app-deploy-manager` is not Brain-specific. It appears on ordinary Launchpad resources across the cluster. Treating it alone as Brain ownership would import unrelated apps.

Mitigation: require either:

- project membership label `cloud.sealos.io/deploy-on-sealos=<projectName>`, or
- explicit user import selection inside a namespace.

### Project Name Is Not a Stable ID

v1 uses project name as membership value. v2 uses a stable project id. A rename or duplicate name can make direct mapping unsafe.

Mitigation: keep an explicit legacy mapping record, or store imported v2 labels on the resources during backfill.

### Partial Label Coverage

v1 adds the project membership label only to the selected top-level resource target. Support resources such as Service/Ingress may not carry `cloud.sealos.io/deploy-on-sealos`; they are joined through `cloud.sealos.io/app-deploy-manager`.

Mitigation: discover top-level workloads by project membership, then discover support resources by app manager.

### DevBox Release Is External

The `cloud.sealos.io/app-devbox-id` label is created by DevBox service, not v1 Brain source. Its exact semantics should be treated as external API behavior.

Mitigation: use it as a trace hint, not as the only import key.

## Recommended Implementation Plan

1. Add a legacy discovery module in the API layer, separate from strict Brain v2 AP discovery.
2. List v1 Instances and resources by `cloud.sealos.io/deploy-on-sealos`.
3. Build a legacy AP adapter that can render AP-like read models from v1 Deployment/StatefulSet plus Service/Ingress support resources.
4. Add response metadata that marks legacy resources as readonly and unimported.
5. Add an explicit import/backfill endpoint or task before enabling lifecycle writes.
6. Add tests with fixtures for:
   - v1 direct Launchpad Deployment + Service + Ingress
   - v1 DevBox CR + DevBox Service + DevBox Ingress
   - DevBox release Deployment with `cloud.sealos.io/app-devbox-id`
   - v1 project membership label on top-level resource only
   - unrelated Launchpad app without project membership label

## Minimal Acceptance Checks

Read-only compatibility is correct when:

1. A namespace with v1 `Instance/project-a` is listed as a legacy project.
2. A Deployment labeled `cloud.sealos.io/deploy-on-sealos=project-a` and `cloud.sealos.io/app-deploy-manager=web` appears under that legacy project.
3. Its Service and Ingress are attached by `cloud.sealos.io/app-deploy-manager=web` even if they lack `cloud.sealos.io/deploy-on-sealos`.
4. A random Launchpad Deployment with only `cloud.sealos.io/app-deploy-manager` is not treated as Brain-owned.
5. Mutating AP endpoints reject legacy resources before import with a clear `requires import` error.
6. After import/backfill, the same resource carries both v1 and v2 labels and is visible through the strict v2 AP selector.
