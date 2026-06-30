# Brain v1 资源兼容性分析

日期：2026-06-29

## 结论

Brain v1 部署出来的项目，不能用当前 Brain v2 的 `brain.io/*` label 合同来识别。v1 使用的是 Sealos 原生资源和原生 labels：

- 项目本体：`app.sealos.io/v1` `Instance`
- 项目归属：`cloud.sealos.io/deploy-on-sealos=<projectName>`
- Launchpad/AP 分组：`cloud.sealos.io/app-deploy-manager=<appName>`
- DevBox 公开访问分组：`cloud.sealos.io/devbox-manager=<devboxName>`
- DevBox release 到 AP 的追踪：生成出来的 Deployment 上有 `cloud.sealos.io/app-devbox-id=<devboxId>`

当前 Brain v2 的 AP 发现和生命周期所有权要求 `brain.io/managed-by=brain` 和 `brain.io/project-id`。所以，如果不增加明确的 legacy 发现/导入路径，v1 创建或 v1 关联的资源会被 v2 AP/project 查询漏掉。

安全的兼容模型应该是：

1. 从 `app.sealos.io/v1` `Instance` 发现 legacy v1 项目。
2. 用 `cloud.sealos.io/deploy-on-sealos=<projectName>` 发现 legacy 项目成员。
3. 对 legacy AP-like workload 先按 imported/readonly 处理，直到显式 backfill Brain v2 ownership labels。
4. 删除、重启、启停、路由修改等破坏性操作继续要求 Brain v2 labels，或者要求显式 import 状态。

## 证据来源

v1 代码：

- 仓库：`https://github.com/aimeritething/brain`
- 分支：`might`
- Commit：`ebfba4df2e4f254952da7cfea4c9d8acafb5a5f0`
- 本次分析使用的本地 checkout：`/tmp/aimeritething-brain-v1`

v2 代码：

- 当前仓库：`/Users/jingyang/work/brain`
- 分析前工作树已有未提交改动；本文档只新增文档，没有修改现有代码。

线上证据：

- 集群：`usw`
- Kubeconfig：`/Users/jingyang/.kube/sealos-usw-admin`
- Context：`sealos-usw-admin`
- Brain 生产 namespace：`brain-system`

## v1 资源模型

### Project

v1 创建项目时创建的是 `app.sealos.io/v1` `Instance`。

证据文件：

- `/tmp/aimeritething-brain-v1/src/lib/sealos/resources/instance/instance-method/instance-utils.ts`
- `/tmp/aimeritething-brain-v1/src/lib/brain/resources/project/project-api/project-api-service.ts`

生成出来的 Instance 形态：

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

项目展示名存在 Instance annotation：

```text
cloud.sealos.io/deploy-on-sealos-displayName
```

v1 没有 `brain.io/project-id`。

### Project Membership

v1 把资源加入项目时，是给资源 metadata patch 这个 label：

```text
cloud.sealos.io/deploy-on-sealos=<projectName>
```

证据文件：

- `/tmp/aimeritething-brain-v1/src/lib/brain/resources/project/project-method/project-mutation.ts`
- `/tmp/aimeritething-brain-v1/src/lib/brain/resources/project/project-api/project-api-service.ts`
- `/tmp/aimeritething-brain-v1/src/lib/sealos/resources/instance/instance-method/instance-query.ts`

从项目移除资源时，也是删除这个 label。项目资源列表使用的 selector 是：

```text
cloud.sealos.io/deploy-on-sealos=<projectName>
```

v1 认为项目成员包括：

- 内置资源：`deployment`、`statefulset`、`configmap`
- 自定义资源：`devbox`、`cluster`、`objectstoragebucket`、`app`

注意：v1 的项目成员 label 是可变的分组 label，不是稳定 UUID。在单个 namespace 内它是实际项目边界；跨 namespace 时，相同 project name 可能重复。

### Launchpad / AP-like Workload

v1 可以直接创建 Launchpad 风格资源。`deployment/deploy-utils.ts` 和 `launchpad-api-utils.ts` 生成的 label 形态一致。

Deployment：

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

Service：

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

Ingress：

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: network-<random>
  labels:
    cloud.sealos.io/app-deploy-manager: <appName>
    cloud.sealos.io/app-deploy-manager-domain: <domainId>
```

这些资源同样没有 Brain v2 labels：

- 没有 `brain.io/managed-by`
- 没有 `brain.io/project-id`
- 没有 `brain.io/deployment-kind`
- 没有 `brain.io/deployment-name`

### DevBox

v1 DevBox 创建基于 DevBox CRD，以及对应的 Service/Ingress。

证据文件：

- `/tmp/aimeritething-brain-v1/src/lib/sealos/resources/devbox/devbox-constant/devbox-constant-resource.ts`

DevBox CR：

```yaml
apiVersion: devbox.sealos.io/v1alpha1
kind: Devbox
metadata:
  name: <devboxName>
spec:
  network:
    type: NodePort
```

DevBox Service：

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

DevBox Ingress：

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

v1 不自己渲染 DevBox release Deployment，而是调用 DevBox 服务：

```text
POST https://devbox.<region>/api/deployDevbox
```

证据文件：

- `/tmp/aimeritething-brain-v1/src/lib/sealos/resources/devbox/devbox-api/devbox-open-api.ts`
- `/tmp/aimeritething-brain-v1/src/hooks/sealos/devbox/use-devbox-deploy.ts`

API 返回：

```ts
{
  data: {
    message: string;
    appName: string;
    publicDomains: { host: string; port: number }[];
  }
}
```

v1 再把 `data.appName` 转成 Deployment target，并通过 patch label 加入当前项目：

```text
cloud.sealos.io/deploy-on-sealos=<projectName>
```

`usw` 线上样本显示，DevBox 服务生成的 Deployment 还会带：

```text
cloud.sealos.io/app-devbox-id=<devboxId>
```

这个 label 不是 v1 Brain 源码定义的，而是外部 DevBox 服务生成的。

## 当前 v2 Label 模型

当前 Brain v2 label 常量定义在：

- `/Users/jingyang/work/brain/apps/api/service/orchestration/labels.go`
- `/Users/jingyang/work/brain/apps/ui/src/lib/brain-labels.ts`

Brain v2 核心 labels：

```text
brain.io/managed-by=brain
brain.io/project-id=<projectId>
brain.io/deployment-kind=<ap|db|template>
brain.io/deployment-name=<deploymentName>
brain.io/template-name=<templateName>
```

v2 保留的 Launchpad 兼容 labels：

```text
cloud.sealos.io/app-deploy-manager=<apName>
cloud.sealos.io/app-deploy-manager-domain=<domainLabel>
app=<apName>
```

v2 直接 AP 渲染会合并 Brain labels 和 Launchpad labels：

```go
brainLabels(projectID, DeploymentKindAP, name)
LaunchpadAppDeployManagerLabel: name
LaunchpadAppLabel: name
```

v2 template deployment 会注入：

```text
brain.io/managed-by=brain
brain.io/project-id=<projectId>
brain.io/deployment-kind=template
brain.io/deployment-name=<instanceName>
brain.io/template-name=<templateName>
```

## 当前不兼容点

### AP List

当前 AP list selector 是：

```text
cloud.sealos.io/app-deploy-manager,
brain.io/managed-by=brain,
brain.io/project-id
```

来源：

- `/Users/jingyang/work/brain/apps/api/route/ap/workload.go`

这会排除 v1 AP-like 资源，因为 v1 只保证：

```text
cloud.sealos.io/app-deploy-manager=<appName>
```

如果这个 v1 资源被加进了 v1 项目，可能还会有：

```text
cloud.sealos.io/deploy-on-sealos=<projectName>
```

但它仍然没有 `brain.io/project-id`。

### AP Get / Lifecycle

当前单个 AP 解析会调用 `requireLaunchpadAPDeployment` / `requireLaunchpadAPStatefulSet`，它们同样要求：

```text
brain.io/managed-by=brain
brain.io/project-id
```

所以即使知道 workload name，v1 Deployment 或 StatefulSet 也不会被 v2 当作 Brain AP。

### Public Access Support Resources

`apSupportResourceAPName()` 可以用 `cloud.sealos.io/app-deploy-manager` 分组 support resources，并 fallback 到 `brain.io/deployment-name`。但是 support-resource list selector 仍然要求：

```text
cloud.sealos.io/app-deploy-manager,
brain.io/managed-by=brain,
brain.io/project-id
```

因此这个 fallback 还不够，纯 v1 资源在 listing 阶段已经被排除了。

### Project Identity

v1 项目身份是 `Instance` 名字。v2 项目身份是 Brain 自己的 `projectId`，存在 Brain labels 和数据库状态里。两者不等价：

- v1：`cloud.sealos.io/deploy-on-sealos=<projectName>`
- v2：`brain.io/project-id=<projectId>`

任何自动兼容层都必须明确如何把 legacy Instance name 映射成 v2 project id。

## `usw` 生产环境发现

### Brain v1 服务

在 `brain-system` 观察到：

```text
Deployment/sealos-brain-frontend image=puddlecat/sealos-brain-ui:20260520.1
Deployment/sealos-brain-ai       image=puddlecat/sealos-brain-ai:20260520.8
```

分析时这两个生产 Deployment 大约 39 天前创建。frontend labels 是 Launchpad 风格：

```text
app=sealos-brain-frontend
app.kubernetes.io/name=brain
app.kubernetes.io/part-of=sealos-brain
cloud.sealos.io/app-deploy-manager=sealos-brain-frontend
```

### 没有 Brain v2 Labels

对 `usw` 做只读查询时，常见 workload/support resources 下没有查到：

```text
brain.io/managed-by=brain
brain.io/deployment-name
```

这和 v1 代码一致：v1 没有定义或写入 `brain.io/*` labels。

### DevBox Release 样本

`usw` 有很多 Deployment 带：

```text
cloud.sealos.io/app-deploy-manager=<releaseAppName>
cloud.sealos.io/app-devbox-id=<devboxId>
app=<releaseAppName>
```

样本：

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

它们的 Service 和 Ingress 只使用 Launchpad labels：

```text
Service/todolist2-release-srrohr
  cloud.sealos.io/app-deploy-manager=todolist2-release-srrohr

Ingress/network-qfwqybrwllnp
  cloud.sealos.io/app-deploy-manager=todolist2-release-srrohr
  cloud.sealos.io/app-deploy-manager-domain=xohzrviysuwa
```

### 重要限制

`brain-system` 里的生产 DB 表没有给出可靠的 v1 项目索引：

- `sealai_project.project_canvas_layouts` 存在，但当前是 0 行。
- `sealai_assistant.assistant_chats` 本次查询没有返回 namespace 样本。

所以 legacy 兼容最可靠的事实来源是 K8s labels 和 `Instance` 资源。

## 兼容设计

### 读路径

新增一个按 namespace 工作的 legacy project read path：

1. 列出 v1 project Instances：

   ```text
   app.sealos.io/v1 Instance
   ```

2. 对每个 Instance `<projectName>`，按这个 selector 列出关联资源：

   ```text
   cloud.sealos.io/deploy-on-sealos=<projectName>
   ```

3. 对 AP-like 展示，纳入带这个 label 的 Deployment/StatefulSet：

   ```text
   cloud.sealos.io/app-deploy-manager
   ```

4. 通过下面的 label 关联 Service/Ingress 等 support resources：

   ```text
   cloud.sealos.io/app-deploy-manager=<appName>
   ```

5. 给这些资源打读模型标记：

   ```text
   origin=legacy-v1
   ownership=legacy-project-label
   writable=false
   ```

这样可以避免把 v1 资源伪装成完整 Brain-owned v2 AP。

### Import / Backfill 路径

如果要让 v1 项目在 v2 里可写，需要显式 import/backfill。

对每个 legacy project：

1. 创建或解析一个 v2 project id。
2. patch project Instance 或存一条映射：

   ```text
   legacyProjectName -> v2ProjectId
   ```

3. 给每个导入的 workload 和 support resources patch：

   ```text
   brain.io/managed-by=brain
   brain.io/project-id=<v2ProjectId>
   brain.io/deployment-kind=<ap|template|db>
   brain.io/deployment-name=<deploymentName>
   ```

4. 保留已有 Sealos labels：

   ```text
   cloud.sealos.io/deploy-on-sealos=<legacyProjectName>
   cloud.sealos.io/app-deploy-manager=<appName>
   cloud.sealos.io/app-devbox-id=<devboxId>
   ```

import 时不要删除 v1 labels。Launchpad、DevBox、已有 Sealos UI 行为仍可能依赖它们。

### 写路径

import 之前：

- 允许 list/detail/log/metrics/public URL 这类可通过 legacy labels 解析的只读展示。
- 阻止 v2 AP API 对 legacy 资源执行 delete、restart、stop/start、routing mutation、storage mutation、env mutation，除非产品上明确决定委托回原 Sealos API，并接受 legacy 语义。

import 之后：

- v2 AP lifecycle 可以基于 Brain labels 操作。
- 操作仍应保留 `cloud.sealos.io/app-deploy-manager` 和 `cloud.sealos.io/deploy-on-sealos`。

## 风险

### 误判 Ownership

`cloud.sealos.io/app-deploy-manager` 不是 Brain 专属。普通 Launchpad 资源也大量使用它。只靠这个 label 会把无关应用误导入 Brain。

缓解方式：必须要求下面条件之一：

- 存在项目成员 label：`cloud.sealos.io/deploy-on-sealos=<projectName>`
- 用户在某个 namespace 内显式选择导入

### Project Name 不是稳定 ID

v1 用 project name 作为成员关系值。v2 用稳定 project id。项目重命名或同名项目会让直接映射不可靠。

缓解方式：保存明确的 legacy mapping，或者在 backfill 时把 v2 labels 写回资源。

### Label 覆盖不完整

v1 通常只给用户选择的顶层资源 patch 项目成员 label。Service/Ingress 这类 support resources 可能没有 `cloud.sealos.io/deploy-on-sealos`，只能通过 `cloud.sealos.io/app-deploy-manager` 关联。

缓解方式：先通过项目成员 label 找顶层 workload，再通过 app manager 找 support resources。

### DevBox Release 是外部行为

`cloud.sealos.io/app-devbox-id` 由 DevBox 服务创建，不是 v1 Brain 源码创建。它的语义应视为外部 API 行为。

缓解方式：把它作为追踪线索，不作为唯一 import key。

## 推荐实施方案

1. 在 API 层新增 legacy discovery module，和严格 Brain v2 AP discovery 分开。
2. 按 `cloud.sealos.io/deploy-on-sealos` 列出 v1 Instances 和项目资源。
3. 增加 legacy AP adapter，把 v1 Deployment/StatefulSet + Service/Ingress support resources 渲染成只读 AP-like read model。
4. 响应里增加 metadata，标记 legacy 资源是 readonly/unimported。
5. 在启用生命周期写操作前，新增显式 import/backfill endpoint 或 task。
6. 增加 fixtures 测试：
   - v1 direct Launchpad Deployment + Service + Ingress
   - v1 DevBox CR + DevBox Service + DevBox Ingress
   - 带 `cloud.sealos.io/app-devbox-id` 的 DevBox release Deployment
   - 只有顶层资源带 v1 project membership label
   - 没有 project membership label 的普通 Launchpad app

## 最小验收标准

只读兼容正确的标准：

1. namespace 中有 v1 `Instance/project-a` 时，它能作为 legacy project 被列出来。
2. 带 `cloud.sealos.io/deploy-on-sealos=project-a` 和 `cloud.sealos.io/app-deploy-manager=web` 的 Deployment 会出现在该 legacy project 下。
3. 即使 Service/Ingress 没有 `cloud.sealos.io/deploy-on-sealos`，也能通过 `cloud.sealos.io/app-deploy-manager=web` 关联到该 AP-like workload。
4. 只有 `cloud.sealos.io/app-deploy-manager` 的普通 Launchpad Deployment 不会被当作 Brain-owned。
5. import 前，AP mutation endpoints 对 legacy 资源返回清晰的 `requires import` 错误。
6. import/backfill 后，同一资源同时保留 v1 labels 和 v2 labels，并能通过严格 v2 AP selector 被发现。

