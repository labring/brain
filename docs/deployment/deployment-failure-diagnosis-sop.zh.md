# 部署失败诊断 SOP

本文用于诊断 Brain 部署任务在 `prepare`、`plan`、`generate-artifacts` 或 `apply` 阶段的失败。默认只做只读检查和 Kubernetes server-side dry-run，不重放真实 Apply，不删除资源，不输出 kubeconfig、镜像仓库凭证或用户输入。

## 1. 固定诊断环境

以下示例使用 `usw-1` 集群和 `brain-v2` namespace，命令适用于 fish：

```fish
set -gx KUBECONFIG /Users/jingyang/.kube/sealos-usw-1-admin
set -gx BRAIN_NAMESPACE brain-v2
set -gx PG_POD brain-v2-pg-postgresql-0
set -gx TASK_ID '<TASK_ID>'

function brain_psql
    kubectl exec -i -n $BRAIN_NAMESPACE $PG_POD -- sh -c \
        'PGPASSWORD="$POSTGRES_PASSWORD" exec psql "$@"' sh \
        -U postgres -d postgres -X $argv
end
```

记录用户界面中的开始、失败时间。界面显示北京时间，Kubernetes 日志通常使用 UTC；北京时间减 8 小时即 UTC。

## 2. 确认真实 Task ID

Task ID 中的 `0/O`、`1/l/I` 容易被截图或 OCR 混淆。先精确查询：

```fish
printf '%s\n' "
select id,status,phase,error,namespace,project_uid,runtime_name,created_at,completed_at
from sealai_deployment.deploy_tasks
where id = :'task_id';" \
    | brain_psql -A -F '|' -v task_id="$TASK_ID"
```

如果返回 0 行，不要继续使用该 ID。按界面时间附近查询候选任务：

```fish
set -gx UTC_START '<UTC_START>'
set -gx UTC_END '<UTC_END>'

printf '%s\n' "
select id,status,phase,error,namespace,project_uid,runtime_name,created_at,completed_at
from sealai_deployment.deploy_tasks
where created_at between :'utc_start'::timestamptz and :'utc_end'::timestamptz
order by created_at;" \
    | brain_psql -A -F '|' -v utc_start="$UTC_START" -v utc_end="$UTC_END"
```

用仓库名、目标项目、namespace 和时间确认真实任务，再更新 `TASK_ID`。

## 3. 获取任务证据链

先取任务摘要，不直接输出完整 `artifact_summary`，因为其中可能含镜像拉取密钥或用户输入：

```fish
printf '%s\n' "
select id,status,phase,error,namespace,project_uid,project_name,runtime_name,
       runtime_state,created_at,completed_at,failure_details::text
from sealai_deployment.deploy_tasks
where id = :'task_id';" \
    | brain_psql -A -F '|' -v task_id="$TASK_ID"
```

然后按时间读取事件：

```fish
printf '%s\n' "
select created_at,kind,phase,message,payload::text
from sealai_deployment.deploy_task_events
where task_id = :'task_id'
order by created_at;" \
    | brain_psql -A -F '|' -v task_id="$TASK_ID"
```

重点记录：

- 最后一个成功步骤。
- 第一个失败步骤。
- `runtime_name`、目标 namespace、`project_uid`。
- 构建 Job、Pod、镜像、digest 和构建状态。
- Apply 开始时间、清理开始时间及实例名。

## 4. 按阶段分流

| 失败位置                    | 优先检查                                                                             |
| --------------------------- | ------------------------------------------------------------------------------------ |
| `prepare`                   | Devbox 创建、Pod 调度、服务重启、namespace 配额                                      |
| `plan` / Analyze repository | Codex gateway URL、503、Higress upstream、gateway timeout                            |
| `generate-artifacts`        | `.sealos/build-result.json`、Kaniko Job/Pod、镜像 digest、输出文件完整性             |
| `apply` / Create resources  | `/api/k8s/v1alpha1/apply`、渲染资源、CRD schema、admission、RBAC、配额、SSA conflict |

界面顶部的 `Failed - Plan` 可能只是任务最终保存的 phase，不一定是真实失败步骤。始终以事件中的 `deployment_task.apply_started`、`failure_details.stage` 和 API 日志为准。

## 5. 检查构建是否真实成功

只读取构建摘要字段：

```fish
printf '%s\n' "
select artifact_summary #>> '{artifacts,0,build,status}' as status,
       artifact_summary #>> '{artifacts,0,build,image}' as image,
       artifact_summary #>> '{artifacts,0,build,digest}' as digest,
       artifact_summary #>> '{artifacts,0,build,job}' as job,
       artifact_summary #>> '{artifacts,0,build,pod}' as pod
from sealai_deployment.deploy_tasks
where id = :'task_id';" \
    | brain_psql -A -F '|' -v task_id="$TASK_ID"
```

判定规则：

- `status=succeeded` 且 digest 非空：构建不是最终失败原因。
- Job 无 Pod：检查 `kubectl describe job`，常见原因是 Pod 配额已满。
- Job `BackoffLimitExceeded`：查看对应 Kaniko Pod 日志；后续若有另一个 Job 成功，以最终持久化的 Job 和 digest 为准。

## 6. 关联 API 日志

根据任务完成时间截取前后 1-2 分钟，先确认 HTTP 路径和状态码：

```fish
kubectl get pods -n $BRAIN_NAMESPACE
kubectl logs -n $BRAIN_NAMESPACE <API_POD> --since=2h --timestamps \
  | rg '/api/k8s/v1alpha1/apply|/api/k8s/v1alpha1/get|/api/k8s/v1alpha1/delete'
```

Apply 路径的关键顺序：

1. Apply `Instance`。
2. GET `Instance` 取得 UID。
3. 为依赖资源添加 ownerReference。
4. Apply Secret/Workload/Service/Ingress/App 等依赖资源。

因此：

- 只有一次 Apply 500，且没有紧随其后的 GET Instance：失败对象是 `Instance`。
- 第一次 Apply 成功、GET 成功、第二次 Apply 失败：失败对象在依赖资源集合中。
- Apply 后进入 readiness：资源创建成功，问题属于运行或就绪检查，不是 Apply。

## 7. 查看资源摘要

只列出资源身份，不输出 YAML 内容：

```fish
printf '%s\n' "
select r->>'apiVersion',r->>'kind',r->>'namespace',r->>'name'
from sealai_deployment.deploy_tasks t,
     jsonb_array_elements(t.artifact_summary->'resources') r
where t.id = :'task_id';" \
    | brain_psql -A -F '|' -v task_id="$TASK_ID"
```

同时检查失败时间附近的 namespace 事件，使用资源名过滤，避免读取整个 namespace 的高噪声事件：

```fish
kubectl get events -n <TARGET_NAMESPACE> -o json \
  | jq -r '.items[]
      | select((.involvedObject.name // "") | contains("<INSTANCE_NAME>"))
      | [.metadata.creationTimestamp,.type,.reason,
         .involvedObject.kind,.involvedObject.name,.message]
      | @tsv'
```

## 8. 用持久化产物做无副作用复现

将渲染后的 YAML 直接从数据库管道传给 API Server，不落盘、不打印内容：

```fish
set -gx TARGET_NAMESPACE '<TARGET_NAMESPACE>'

printf '%s\n' "
select string_agg(value, E'\\n---\\n')
from sealai_deployment.deploy_tasks t,
     jsonb_array_elements_text(t.artifact_summary->'resourceYamls') value
where t.id = :'task_id';" \
    | brain_psql -t -A -v task_id="$TASK_ID" \
    | kubectl apply --server-side --dry-run=server \
        --field-manager=k8s-apply -n $TARGET_NAMESPACE -f -
```

该命令可直接返回：

- CRD 中未声明字段。
- 类型或必填字段错误。
- Admission Webhook 拒绝。
- ResourceQuota 拒绝。
- Server-side apply 字段冲突。

管理员 dry-run 可以验证 schema、admission 和资源形态，但不能证明任务使用的租户身份拥有相同权限。若错误疑似 RBAC，必须使用任务实际身份检查；不要把 kubeconfig 输出到终端或文件。

## 9. 对照 CRD schema

如果错误为 `field not declared in schema`，读取对应 CRD：

```fish
kubectl get crd <PLURAL>.<GROUP> -o json \
  | jq '.spec.versions[]
      | select(.name=="<VERSION>")
      | .schema.openAPIV3Schema.properties.spec'
```

对比渲染资源中的字段与 CRD 允许字段。选择修复位置时遵循：

- 如果字段只是 Template 元数据，运行时 Instance 不需要：在 renderer 中过滤。
- 如果 Instance 的产品契约确实需要该字段：升级 CRD schema，并验证旧集群兼容性。
- 不要通过关闭 schema 校验或改用非结构化补丁掩盖契约不一致。

## 10. 定位代码和 commit

仓库存在 `.codegraph/` 时先使用 CodeGraph：

```fish
codegraph explore "Where is the failing Kubernetes object constructed and applied?"
```

然后对具体代码运行：

```fish
git blame -L <START>,<END> -- <FILE>
git show <COMMIT> -- <FILE>
```

定位时区分两类问题：

- **触发失败的代码**：生成了不符合 CRD、配额或 admission 约束的资源。
- **隐藏错误的代码**：API 已返回详细错误，但 UI 只显示通用 fallback。

两者可能属于不同 commit，报告中必须分别说明，不能把“错误被吞”当成 Kubernetes 拒绝的根因。

## 11. 标准结论模板

每次诊断按以下格式收尾：

```text
结论：<一句话根因>

失败阶段：<prepare/plan/generate/apply/readiness>
失败对象：<apiVersion kind namespace/name>
原始错误：<API Server、gateway 或构建工具的错误>

证据：
- <任务事件>
- <构建状态或 API 日志>
- <server-side dry-run 或 CRD schema>

已排除：
- <不是构建问题>
- <不是配额问题>
- <不是 warning>

代码位置：<file:line>
引入 commit：<hash 和 subject>
建议修复：<最小、明确的修复方向>
```

## 12. 本次案例示例

任务 `U1n0e0WxktmG9O3u` 的构建成功，Apply API 返回 500。日志显示第一次 Apply 后没有 GET Instance，因此失败对象是 `app.sealos.io/v1 Instance/banana-slides-hxpwuf`。服务端 dry-run 返回：

```text
.spec.inputs.ai_provider_format.options: field not declared in schema
.spec.inputs.output_language.options: field not declared in schema
```

集群 `Instance` CRD 的 `spec.inputs.*` 只允许 `type`、`default`、`description` 和 `required`。renderer 在 `templateInstanceObject()` 中通过 `inputs: asRecord(spec.inputs) ?? {}` 原样复制 Template 输入，导致 `options` 进入 Instance。该逻辑由 commit `33c4e5df` 引入。

另外，API 的详细错误曾被 UI 的通用 fallback 覆盖。诊断时应始终保留 Huma `detail/errors`，并将脱敏后的 Apply 原始错误写入 `failure_details`。
