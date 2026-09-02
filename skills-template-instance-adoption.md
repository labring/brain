# Sealos Skills：Template 部署后认领 Brain Project

Brain 侧接口已在分支 `feat/adopt-template-instance`（issue [labring/sealos-private#116](https://github.com/labring/sealos-private/issues/116)）。本文只写 **labring/sealos-skills** 需要做的事。

## 不要改什么

- 不要改 Template YAML 生成、Template API apply、镜像构建、Runtime Truth。
- 不要让 Agent 收集并提交资源列表或重新 apply YAML。
- 不要在 apply 前先调 Brain 建空 Project。
- **Brain 托管部署里不要调用认领接口。** 环境变量存在 `SEALAI_DEPLOY_TASK_ID` 或 `SEALAI_PROJECT_ID` 时，Brain 已经用 `SEALAI_DEPLOY_LABELS_JSON` → Template API `extraLabels` 打过 `brain.io/*`。再认领会 409。

## 要改什么

在 **本地 / 非 Brain 托管** 路径上，`deploy-template.mjs`（或同一条 apply 成功路径）在 Template 部署成功、拿到 Instance 名之后，立刻 POST 一次认领。失败可重试，不要为此重做部署。

建议落在 `skills/sealos-deploy`：apply 成功的脚本里直接调，不要只写在 SKILL.md 指望模型记得。

## 调用契约

```
POST https://brain.<cloudDomain>/api/projects/adopt-template-instance
Authorization: Bearer <url-encoded kubeconfig>
Content-Type: application/json
```

`<cloudDomain>` 与现有 region 一致（例如 kubeconfig / `config.json` 里 `template.gzg.sealos.run` → `gzg.sealos.run`）。当前 Brain Helm 给 UI 配了 `domainPrefix: brain`，所以入口是 `https://brain.<cloudDomain>`。不要从请求体传 namespace。

kubeconfig 必须是这次 apply 用的那份（`~/.sealos/kubeconfig` 或注入的那份），且 current-context 的 namespace 就是 Instance 所在 namespace。Brain 只信这个 namespace。

### 请求体

```json
{
  "instanceName": "<Template Instance metadata.name>",
  "templateName": "<可选，模板名，用于 Project 显示名和 brain.io/template-name>",
  "displayName": "<可选，显式 Project 名；冲突返回 409，不会自动改名>",
  "description": "<可选，最多 256 字符>"
}
```

必填只有 `instanceName`。不要传 `namespace`，传了也会被丢掉。

默认：不传 `displayName`，让 Brain 按 ADR 0058 从 `templateName`（否则 Instance 名）派生，重名自动加 `-2`。

### 成功（200）

```json
{
  "project": {
    "id": "<uuid>",
    "namespace": "<from kubeconfig>",
    "displayName": "...",
    "description": "",
    "createdAt": "...",
    "updatedAt": "..."
  },
  "adoption": {
    "status": "adopted",
    "instanceName": "...",
    "instanceUid": "...",
    "discoveredCount": 4,
    "labeledCount": 4,
    "warnings": ["incompleteResourceSet", "podTemplateLabelsUnchanged"]
  }
}
```

同一 Instance UID 再 POST 一次：同一 `project.id`，并再打一遍后来才出现的子资源。Agent 重试是安全的。

同名但 Kubernetes UID 变了（删了重建）：当成新部署，会新建 Project。

### 错误 `{ "error": string }`

| HTTP | 含义 | Skills 该做什么 |
| --- | --- | --- |
| 401 / 400 鉴权 | kubeconfig 缺失/无效/解析不出 namespace | 停；不要重部署 |
| 403 | namespace 无权 | 停 |
| 404 | Instance 还不存在 | 短等后重试认领，不要重新 apply |
| 400 不是 Instance | 名字不是 `app.sealos.io/v1 Instance` | 停；检查传的是 Instance 名不是 App 名 |
| 400 too many resources | 发现对象 > 500 | 停；不要拆成多次认领（UID 会绑同一个 Project，但超限根本不会认领） |
| 409 他 Project 的 label | 资源已有别人的 `brain.io/project-id` | 停；不要覆盖 |
| 409 显示名冲突 | 显式 `displayName` 已被占用 | 去掉 displayName 重试，或换名字 |
| 502 | 打标失败（映射会标 failed） | 只重试认领，同一 Project ID 会续上 |
| 503 | Brain Postgres 不可用 | 重试认领 |

`warnings` 里出现 `incompleteResourceSet`：当时只发现了 Instance 本身。等几秒再 POST 一次（幂等）。根因常常是子资源还没进集群，或子资源缺少 `cloud.sealos.io/deploy-on-sealos=<instanceName>`。

## 发现依赖（YAML 侧唯一相关约束）

Brain **不会**扫整个 namespace。它只：

1. GET `instances.app.sealos.io/<instanceName>`
2. 在固定 allowlist kind 上 list `cloud.sealos.io/deploy-on-sealos=<instanceName>`
3. 在这份 list 结果里再按 Instance ownerRef 过滤

没有这个 label、又没出现在上述 list 里的对象，认领不到，Project 删除也管不到。

当前 `docker-to-sealos` 规格要求 StatefulSet **省略** `cloud.sealos.io/deploy-on-sealos`。若 Template API 也不会补上，这些 StatefulSet 不会进 Brain。

**Skills 侧最小修正：** 凡是希望被 Brain 管理的 namespaced 资源（含 Instance、AP 工作负载、DB Cluster、Service、Ingress、PVC 等）都带 `cloud.sealos.io/deploy-on-sealos=<instanceName>`。不要为此改工作负载的 `spec.template` 选择器。不要在 Skills 里写 `brain.io/*`（Project ID 当时还不存在）。

不要改 Sealos 原生 AP/DB 身份 label（`cloud.sealos.io/app-deploy-manager`、KubeBlocks labels）。Brain 靠它们识别 AP/DB，靠 `brain.io/project-id` 归到 Project。

## 建议的脚本行为

伪代码（本地路径）：

```
if env SEALAI_DEPLOY_TASK_ID or SEALAI_PROJECT_ID:
  skip  # Brain 托管部署已经打标
instanceName = template deploy 返回的 Instance 名
POST adopt { instanceName, templateName }
if 404 or 502 or warning incompleteResourceSet:
  wait 2–5s, POST 同一 body 最多几次
不要因为认领失败而 delete/re-apply Instance
```

Authorization 头与现有 Template API 调用一样：Bearer + url-encoded kubeconfig。

## 验收（Skills 改完）

1. 本地 Codex/Claude 用 Skills 部署一个模板（非 `SEALAI_DEPLOY_TASK_ID`）：Brain 项目列表出现新 Project，Canvas 能看到 AP/DB。
2. 同一 Instance 再认领一次：还是同一个 `project.id`。
3. 带 `SEALAI_DEPLOY_TASK_ID` 的托管部署：Skills **不**调用该接口，任务仍只走 extraLabels。
4. Instance 尚未就绪时认领：404 或 `incompleteResourceSet` 后重试成功，集群里没有第二个 Instance。
