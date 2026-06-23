# Template Agent-Friendly Core Test Cases

Status: ready for agent execution

本文档面向能操作浏览器、Network 面板、产品 API 或 K8s 查询的 Agent。目标是用产品真实入口验证 Template 部署的完整行为，而不是只验证某个内部函数。

## 0. Scope

覆盖范围：

- Template catalog 加载和模板选择。
- Template 参数默认值、required 参数和提交校验。
- 通过 UI 创建 Template deployment task。
- Template runner 生成、渲染、应用 Sealos Template artifact。
- Brain deployment-scoped labels 注入和查询契约。
- Template-produced workload / DB / PublicAccess 在 canvas 中的投影。
- Template-produced resource 的可见 action 与后端 API 能力一致性。
- Template-created project 删除和资源清理。

不覆盖范围：

- 不测试 AP Docker image 创建；见 `docs/agent-friendly-tests/ap-docker-lifecycle/CORE_AP_DOCKER_LIFECYCLE_TEST_CASES.md`。
- 不测试 DB deployer 创建 DB。
- 不测试 GitHub OAuth、GitHub repo 推荐模板、AI prompt deployment。
- 不把 `TemplateNative` 当成用户可见资源类型、Kubernetes label value、或部署类型。
- 不直接修改生产 namespace 或数据库数据。
- 不要求测试 Agent 修复产品问题；失败只记录为测试结果。

## 1. Product Contract Under Test

Template catalog 通过产品 API 加载：

- `GET /api/templates`
- 可选 query：`language=<language>`
- 成功响应包含 `templates` 数组。

UI Template 部署应创建 deployment task：

- `POST /api/deploy-tasks`
- `source.kind = "template"`
- `source.templateName = <templateName>`
- `source.args = <template args>`
- `runner.kind = "template"`
- `target.kind = "newProject"` 或 `target.kind = "existingProject"`

Direct template deploy endpoint 也存在：

- `POST /api/templates/deploy`
- request body 包含 `encodedKubeconfig`、`namespace`、`projectId`、`projectName`、`instanceName`、`templateName`、`args`
- 该 endpoint 直接调用 provider deploy，并注入 `extraLabels`
- 本文档优先测试 UI 创建的 deployment task；direct endpoint 只作为专项 API 兼容检查。

Template 资源的 Brain label contract：

```text
brain.io/managed-by=brain
brain.io/project-id=<projectId>
brain.io/deployment-kind=template
brain.io/deployment-name=<templateInstanceName>
brain.io/template-name=<templateName>
```

这些 labels 必须存在于 Brain 管理的 rendered resources 上。对 workload，还应存在于 pod template metadata。对 StatefulSet `volumeClaimTemplates`，也应存在于 PVC template metadata。

Canvas projection contract：

- Deployment 或 StatefulSet 可投影为 AP-like workload。
- KubeBlocks Cluster 可投影为 DB-like resource。
- Ingress 可作为 AP Public Access evidence。
- Service 是 support evidence，可用于把 Ingress backend 关联回 workload。
- `TemplateNative` 是内部 deployment projection kind，不是用户可见产品类型。

## 2. Agent Execution Contract

每次执行使用唯一后缀：

- Run id：`YYYYMMDD-HHMMSS`
- Project prefix：`agent-template-<run-id>`
- Primary project：`agent-template-main-<run-id>`
- Delete-only project：`agent-template-delete-<run-id>`
- Direct API project：`agent-template-api-<run-id>`

每个用例必须记录：

- Brain UI URL。
- 当前 namespace。
- project id 和 project display name。
- template name、template title、required args、最终 args。
- deployment task id。
- Network request path、method、status、关键 request body 摘要。
- canvas 中出现的节点类型、节点名、状态、public address 或 connection 信息。
- 可见 UI 结果或截图。
- 最终 verdict：`PASS`、`FAIL`、`BLOCKED`、`SKIPPED`。
- 清理结果。

执行原则：

- 优先通过真实 UI 操作触发行为。
- API 和 K8s 查询只作为证据补充，不替代 UI 可操作性判断。
- 不直接从页面里裸 `fetch()` 调 lifecycle API 作为产品功能结论；裸请求可能绕过产品封装鉴权。
- 遇到资源长时间停留在 transitional 状态时，记录状态并判定 `BLOCKED` 或 `FAIL`，不要无限等待。
- destructive 操作前必须确认目标 project/resource 名称。

## 3. Preflight

### TC-TPL-00 Open Brain And Confirm Environment

Goal: 确认测试环境可操作 Brain，并具备创建 Template project 的凭据。

Steps:

1. 打开 Brain UI。
2. 确认 project explorer、project canvas、或 project creation 入口可见。
3. 记录当前 namespace。
4. 打开浏览器 Network 面板或等价请求捕获工具。
5. 确认没有持续的 `401`、`403`、missing kubeconfig、missing namespace、或 Go API `502`。
6. 请求或观察 `GET /api/templates`。

Expected:

- Brain UI 可用。
- Product API 请求带有正确 auth/kubeconfig context。
- `GET /api/templates` 返回 200，或在 provider 不可用时返回清晰错误。

Evidence:

- Brain UI URL。
- Namespace。
- `GET /api/templates` status。
- 若失败，记录错误 body。

Failure handling:

- 如果 auth/kubeconfig 缺失，停止后续创建类用例，记录 `BLOCKED`。
- 如果 template provider 不可用，catalog、参数、部署类用例全部 `BLOCKED`。

## 4. Template Catalog And Parameters

### TC-TPL-CAT-01 Load Template Catalog

Goal: 验证 Template 入口可以加载模板列表，并展示 Agent 可理解的模板信息。

Steps:

1. 打开 project creation 入口。
2. 选择 `Template` 或等价部署类型。
3. 等待模板下拉出现。
4. 打开模板下拉，搜索一个可用模板。
5. 记录至少一个模板的 `name`、title、description、category、source repos、args。

Expected:

- UI 展示至少一个模板。
- `GET /api/templates` 返回 200。
- 模板项至少有稳定 `name`。
- 模板选择控件支持搜索或选择。

Evidence:

- Template catalog 截图。
- `GET /api/templates` response 摘要。
- 被选模板的 `name` 和 args 列表。

### TC-TPL-CAT-02 Parameter Defaults Are Pre-Filled

Goal: 验证 template args 的 default 值会预填，Agent 不需要猜参数。

Preconditions:

- 已完成 `TC-TPL-CAT-01`。
- 选择一个至少包含 1 个 arg 且有 default 的模板；如果 catalog 没有这种模板，本用例 `SKIPPED`。

Steps:

1. 选择目标模板。
2. 打开 Parameters 区域。
3. 对每个带 default 的 arg，记录输入框初始值。
4. 切换到另一个模板，再切回目标模板。
5. 再次记录 default 值。

Expected:

- 带 default 的 args 在 UI 中预填。
- 切换模板后，args 按当前选中模板重置，不保留上一个模板的无关值。

Evidence:

- 参数区截图。
- 目标 arg key、default、实际输入框 value。

### TC-TPL-CAT-03 Required Parameter Validation

Goal: 验证 required args 缺失时不能提交，且反馈对 Agent 可理解。

Preconditions:

- 已完成 `TC-TPL-CAT-01`。
- 选择一个包含 required args 的模板；如果 catalog 没有 required args 模板，本用例 `SKIPPED`。

Steps:

1. 选择目标模板。
2. 清空一个 required arg。
3. 观察 Deploy 按钮状态。
4. 尝试点击 Deploy，如果按钮可点击。
5. 填回合法值。
6. 再次观察 Deploy 按钮状态。

Expected:

- required arg 为空时，Deploy 按钮 disabled，或提交后显示明确错误。
- 填回合法值后，Deploy 按钮可用。
- 不应创建 `/api/deploy-tasks` 记录。

Evidence:

- 清空参数后的按钮状态截图。
- Network 中没有成功的 `POST /api/deploy-tasks`。

### TC-TPL-CAT-04 Search And Switch Template

Goal: 验证模板搜索和切换不会污染 args。

Steps:

1. 打开 Template 搜索控件。
2. 搜索一个模板名或 title 片段。
3. 选择搜索结果。
4. 修改一个 arg。
5. 选择另一个模板。
6. 再切回第一个模板。

Expected:

- 搜索结果按输入过滤。
- 选中模板后 title / description / args 更新。
- 切换模板后 args 使用新模板 defaults，不保留不属于当前模板的参数。

Evidence:

- 搜索关键字。
- 两个模板的 name。
- 切换前后的 args 摘要。

## 5. Template Deployment Task

### TC-TPL-DEPLOY-01 Create New Project From Template

Goal: 通过 UI 创建 Template project，并验证 deployment task contract。

Input:

- Project name：`agent-template-main-<run-id>`
- Template：优先选择 required args 最少、default 值完整、能产生 workload 的模板。
- Args：使用 UI default；如果 required arg 无 default，填入测试环境可接受的最小合法值。

Steps:

1. 打开 project creation 入口。
2. 选择 `Template`。
3. 选择目标模板。
4. 填写或确认 args。
5. 设置 project name 为 `agent-template-main-<run-id>`。
6. 点击 Deploy。
7. 捕获 `POST /api/deploy-tasks`。
8. 等待 task-created toast 或 deployment progress 出现。
9. 进入新 project canvas。
10. 打开 Deployment Task Timeline。

Expected:

- `POST /api/deploy-tasks` 返回 201。
- Request body 中 `source.kind = "template"`。
- Request body 中 `source.templateName` 等于 UI 选中的 template name。
- Request body 中 `runner.kind = "template"`。
- Request body target 指向新 project 或创建新 project 的 display name。
- Timeline 进入 queued、resolve-target、prepare、generate-artifacts、apply、verify、completed 中的合理阶段。

Evidence:

- Task id。
- Project id/name。
- Namespace。
- Template name。
- Args 摘要。
- `POST /api/deploy-tasks` request body 摘要。
- Timeline 截图。

Cleanup:

- 保留该 project，供后续 projection、label、lifecycle 用例复用。

### TC-TPL-DEPLOY-02 Deployment Task Projection Is Queryable

Goal: 验证 Template deployment task 能通过 project id 查询到 projection。

Preconditions:

- 已完成 `TC-TPL-DEPLOY-01`。

Steps:

1. 记录 `TC-TPL-DEPLOY-01` 的 project id。
2. 请求 `GET /api/deploy-tasks?projectId=<projectId>`。
3. 打开 project canvas，观察 deployment placeholder 或最终节点。
4. 对比 API projection 与 canvas 展示。

Expected:

- API 返回 `projections` 数组。
- 对应 task 的 `source.kind` 为 `template`。
- Projection 中的 slots、result mappings、或 artifact summary 能解释 canvas 上的占位或最终节点。
- Canvas 不应出现与 projection 无关的脏节点。

Evidence:

- `GET /api/deploy-tasks` response 摘要。
- Canvas 截图。

### TC-TPL-DEPLOY-03 Template Task Failure Is Actionable

Goal: 验证 Template deployment 失败时，Agent 能看到可定位的错误。

Preconditions:

- Catalog 中存在可用模板。

Steps:

1. 创建 delete-only 或 failure-only project：`agent-template-failure-<run-id>`。
2. 选择一个 required arg 可被 UI 提交但值明显无效的模板参数；如果没有可安全构造的无效值，本用例 `SKIPPED`。
3. 点击 Deploy。
4. 打开 Deployment Task Timeline。
5. 等待 task 进入 failed，或等待明确错误 toast。

Expected:

- 失败不会静默停留在不明状态。
- Timeline、toast、或 task detail 能展示 provider/render/apply/verify 哪一阶段失败。
- Error message 对 Agent 可记录，不只是一句 generic failure。

Evidence:

- Task id。
- Timeline phase/status。
- Error message。
- Network status。

Cleanup:

- 删除 failure-only project。

## 6. Rendered Artifact And Brain Labels

### TC-TPL-LABEL-01 Rendered Resources Carry Brain Labels

Goal: 验证 template rendered resources 带有 deployment-scoped Brain labels。

Preconditions:

- 已完成 `TC-TPL-DEPLOY-01`。
- Deployment task 已进入 completed，或至少进入 apply/verify 且资源已创建。

Steps:

1. 从 canvas、task artifact summary、或 K8s 查询中获取 template-produced resources。
2. 对每个 Brain-managed rendered resource 读取 metadata.labels。
3. 验证固定 label set：
   - `brain.io/managed-by=brain`
   - `brain.io/project-id=<projectId>`
   - `brain.io/deployment-kind=template`
   - `brain.io/deployment-name=<templateInstanceName>`
   - `brain.io/template-name=<templateName>`
4. 对 Deployment 或 StatefulSet，读取 `spec.template.metadata.labels`。
5. 对 StatefulSet，读取 `spec.volumeClaimTemplates[*].metadata.labels`。

Expected:

- 所有 Brain-managed rendered resources 都有固定 label set。
- Workload pod template labels 也有固定 label set。
- StatefulSet PVC template labels 也有固定 label set。
- 不要求存在旧 labels：`brain.io/resource-kind`、`brain.io/resource-name`、`brain.io/app-name`、`brain.io/db-name`。

Evidence:

- K8s/API 查询路径或命令摘要。
- 至少 1 个 workload resource labels。
- 如果存在 StatefulSet，记录 pod template 和 PVC template labels。

Failure handling:

- 如果资源缺少 labels，判定 `FAIL`，因为这会影响 project explorer、canvas projection、cleanup selectors。

### TC-TPL-LABEL-02 Label Selectors Discover Template Resources

Goal: 验证 template resources 可通过 Brain deployment-scope selector 查到。

Preconditions:

- 已完成 `TC-TPL-LABEL-01`。

Steps:

1. 使用 selector：

```text
brain.io/managed-by=brain,brain.io/project-id=<projectId>,brain.io/deployment-kind=template
```

2. 查询 namespace 中相关 workloads、services、ingresses、clusters、secrets、PVCs。
3. 记录查询结果数量和 resource names。

Expected:

- Selector 能查到 template-created resources。
- 查询结果不混入其他 project 的 resources。
- 如果 template 只产生少量资源，至少应能查到 Instance 或 workload/support resources。

Evidence:

- Selector 字符串。
- Resource list 摘要。

### TC-TPL-LABEL-03 Direct Template Deploy Extra Labels

Goal: 验证 direct endpoint 注入的 `extraLabels` 与 deployment task contract 一致。

Preconditions:

- 当前环境允许安全调用 `POST /api/templates/deploy`。
- 已知 `encodedKubeconfig`、namespace、project id、project name。
- 如果缺少安全凭据，本用例 `SKIPPED`，不要要求用户临时提供 secret。

Steps:

1. 创建或选择 `agent-template-api-<run-id>` project。
2. 调用 `POST /api/templates/deploy`，body 包含：
   - `encodedKubeconfig`
   - `namespace`
   - `projectId`
   - `projectName`
   - `instanceName`
   - `templateName`
   - `args`
3. 验证 response 中 `instanceName` 和 `resources`。
4. 查询 created resources labels。

Expected:

- Endpoint 返回 200。
- Response resources 可定位。
- Created resources 带有和 `TC-TPL-LABEL-01` 相同的 Brain label set。

Evidence:

- Request body 摘要，不记录完整 kubeconfig。
- Response resource summary。
- Labels 摘要。

Cleanup:

- 删除 direct API 创建的 project 或 created resources。

## 7. Canvas Projection

### TC-TPL-CANVAS-01 Template Deployment Placeholder Handoff

Goal: 验证 Template deployment task 占位节点能交接到最终资源节点。

Preconditions:

- 已完成 `TC-TPL-DEPLOY-01`。

Steps:

1. Deploy 后立即进入 project canvas。
2. 观察 deployment placeholder、timeline dock、或 pending node。
3. 等待 task apply/verify/completed。
4. 观察最终节点是否替换或接管 placeholder 位置。
5. 刷新页面，再次进入 project canvas。

Expected:

- Task 运行中有可解释的占位状态。
- 完成后出现最终 template-produced nodes。
- 刷新后 layout 不丢失，不重复创建同一资源节点。

Evidence:

- 运行中 canvas 截图。
- 完成后 canvas 截图。
- 刷新后 canvas 截图。

### TC-TPL-CANVAS-02 TemplateNative Is Internal Only

Goal: 验证 `TemplateNative` 不被展示成用户可见资源类型。

Preconditions:

- 已完成 `TC-TPL-DEPLOY-01`。

Steps:

1. 查看 canvas 节点标题、类型标签、资源面板。
2. 打开 Deployment Task Timeline 或 projection 调试信息。
3. 如果 API projection 中出现 `TemplateNative`，记录其用途。
4. 检查 UI 是否把它展示为用户可理解的 workload/template-produced resource，而不是裸露内部类型。

Expected:

- 用户界面不应把 `TemplateNative` 当成产品资源类型直接展示。
- 如果内部 projection 使用 `TemplateNative`，它只用于 layout / placeholder / handoff。

Evidence:

- Canvas 节点截图。
- Projection response 中相关 ref 摘要。

### TC-TPL-CANVAS-03 AP-Like Workload Projection

Goal: 验证 Template 产生的 Deployment 或 StatefulSet 可被投影为 AP-like workload。

Preconditions:

- 选择的模板会产生 Deployment 或 StatefulSet；如果没有，本用例 `SKIPPED`。

Steps:

1. 在 canvas 找到 template-produced workload。
2. 打开节点面板。
3. 记录 display name、resource name、status、image、ports、public address。
4. 对比 K8s resource kind 和 labels。

Expected:

- Workload 节点可见。
- 节点可打开资源面板。
- Resource name 与 backing Deployment/StatefulSet 可对应。
- 状态来自资源事实，不来自 deployment task 的旧占位。

Evidence:

- Node 截图。
- Resource details 截图。
- Backing resource kind/name。

### TC-TPL-CANVAS-04 DB-Like Resource Projection

Goal: 验证 Template 产生的 KubeBlocks Cluster 可被投影为 DB-like resource。

Preconditions:

- 选择的模板会产生 KubeBlocks Cluster；如果没有，本用例 `SKIPPED`。

Steps:

1. 在 canvas 找到 DB-like node。
2. 打开节点面板。
3. 记录 engine、status、connection 信息。
4. 查询 backing Cluster labels。

Expected:

- DB-like node 可见。
- Connection 信息可读或有明确 loading/error 状态。
- Backing Cluster 带有 template deployment labels。

Evidence:

- Canvas node 截图。
- Connection 面板截图。
- Cluster labels 摘要。

### TC-TPL-CANVAS-05 Public Access Projection

Goal: 验证 Template-created Ingress 能被投影为 AP Public Access evidence。

Preconditions:

- 选择的模板会产生 Ingress；如果没有，本用例 `SKIPPED`。

Steps:

1. 在 canvas 找到 AP-like workload。
2. 检查是否出现 public access address、public access node、或 presentation edge。
3. 查询 backing Ingress。
4. 验证 Ingress backend 指向 Service，Service selector 可关联 workload pod labels。

Expected:

- Public access 展示来自 Ingress/Service/workload 关系。
- 不依赖 `brain.io/resource-kind=public-access`。
- Public access 不应作为独立 Brain deployment kind。

Evidence:

- Public address 或 public access 状态。
- Ingress name/host/path。
- Service backend relationship 摘要。

## 8. Template-Produced Resource Actions

### TC-TPL-ACTION-01 Visible Actions Match Backend Capability

Goal: 验证 template-produced resource 上可见 action 与实际 API 能力一致。

Preconditions:

- 已完成 `TC-TPL-CANVAS-03`。
- Workload 当前处于可操作状态。

Steps:

1. 点击 template-produced AP-like workload。
2. 打开 action menu。
3. 记录可见 action。
4. 如果可见 Restart，点击 Restart。
5. 如果可见 Stop，点击 Stop。
6. 如果 Stop 成功且 Start 出现，点击 Start。
7. 捕获 Network 请求和 status。

Expected:

- UI 不应暴露后端无法处理的 action。
- 可见 action 应返回 2xx，或 UI 应给出明确、可记录、不会误导的错误。
- 如果后端 AP lifecycle API 无法识别 template-produced workload，UI 应隐藏 AP lifecycle action 或走 template-aware endpoint。

Evidence:

- Action menu 截图。
- Network 请求路径、method、status。
- Toast 或 error message。

Known failure signal:

- 如果 `POST /api/ap/v1alpha1/restart` 返回 404，或 `PATCH /api/ap/v1alpha1?...` 返回 404，本用例 `FAIL`。

### TC-TPL-ACTION-02 Delete Action Scope Is Project-Level Or Resource-Level Clear

Goal: 验证 template-produced resource 的删除 action 不会误删错误范围。

Preconditions:

- 已完成 `TC-TPL-DEPLOY-01`。
- 如果 UI 没有 resource-level delete，本用例记录 `SKIPPED`，转执行 project delete。

Steps:

1. 打开 template-produced resource action menu。
2. 查找 Delete。
3. 如果存在 Delete，打开确认弹窗但不提交。
4. 记录弹窗标题、目标名、说明文案。
5. 关闭弹窗。

Expected:

- Delete 文案明确说明删除 resource 还是删除整个 project/template deployment。
- 确认输入应使用可见 display name。
- 不应把 project-level cleanup 伪装成单 resource delete。

Evidence:

- Delete confirmation 截图。
- 目标名和说明文案。

## 9. Project Delete And Cleanup

### TC-TPL-CLEAN-01 Delete Template-Created Project

Goal: 验证删除 template-created project 能清理 deployment task 和 template-produced resources。

Preconditions:

- 已完成 `TC-TPL-DEPLOY-01`。
- 已完成需要复用 primary project 的后续用例。

Steps:

1. 返回 project 列表。
2. 找到 `agent-template-main-<run-id>`。
3. 打开 project action menu。
4. 点击 Delete。
5. 在确认输入框输入 project display name。
6. 点击确认删除。
7. 等待删除成功 toast。
8. 刷新 project list。
9. 使用 project id 或 labels 查询残留 resources。

Expected:

- 删除确认按钮在输入正确 display name 前 disabled。
- Project 从列表消失。
- `GET /api/deploy-tasks?projectId=<projectId>` 不再作为可操作 project 展示依据。
- Template resources 不再出现在 canvas 或 project explorer。
- Cleanup selectors 不应漏掉 `brain.io/deployment-kind=template` resources。

Evidence:

- Delete confirmation 截图。
- Project list 删除后截图。
- 残留 resource 查询摘要。

### TC-TPL-CLEAN-02 Delete-Only Project Cleanup

Goal: 使用独立 project 验证删除流程，不影响 primary project 的其他测试。

Steps:

1. 创建 `agent-template-delete-<run-id>` project。
2. 等待至少一个 template-produced resource 出现。
3. 立即执行 project delete。
4. 查询残留 resources。

Expected:

- Delete-only project 可以被完整清理。
- 删除流程不会影响 primary project。

Evidence:

- Delete-only project id。
- 删除前后 project list。
- 残留 resource 查询摘要。

## 10. Direct API Compatibility

### TC-TPL-API-01 Invalid Direct Template Deploy Request Is Rejected

Goal: 验证 `POST /api/templates/deploy` 对缺失字段返回明确 400。

Steps:

1. 请求 `POST /api/templates/deploy`，body 只包含 `{}`。
2. 记录 status 和 response body。

Expected:

- 返回 400。
- Response body 包含 `Invalid template deploy request.`。
- Response body 包含 zod flatten details 或等价字段级错误。

Evidence:

- Request path。
- Status。
- Error body 摘要。

### TC-TPL-API-02 Direct Template Deploy Authorization Failure Is Clear

Goal: 验证 direct endpoint 在凭据不合法时不会静默失败。

Steps:

1. 构造一个不含有效 kubeconfig 的 request body，但保留其他必填字段。
2. 请求 `POST /api/templates/deploy`。
3. 记录 status 和 response body。

Expected:

- 返回 4xx 或明确授权错误。
- 不创建 template resources。
- Error message 可说明 namespace/kubeconfig/project authorization 问题。

Evidence:

- Status。
- Error body 摘要。
- 资源未创建的查询证据。

## 11. Reporting Matrix

Agent 执行后使用以下矩阵汇总：

| Case | Status | Evidence | Notes |
| --- | --- | --- | --- |
| TC-TPL-00 |  |  |  |
| TC-TPL-CAT-01 |  |  |  |
| TC-TPL-CAT-02 |  |  |  |
| TC-TPL-CAT-03 |  |  |  |
| TC-TPL-CAT-04 |  |  |  |
| TC-TPL-DEPLOY-01 |  |  |  |
| TC-TPL-DEPLOY-02 |  |  |  |
| TC-TPL-DEPLOY-03 |  |  |  |
| TC-TPL-LABEL-01 |  |  |  |
| TC-TPL-LABEL-02 |  |  |  |
| TC-TPL-LABEL-03 |  |  |  |
| TC-TPL-CANVAS-01 |  |  |  |
| TC-TPL-CANVAS-02 |  |  |  |
| TC-TPL-CANVAS-03 |  |  |  |
| TC-TPL-CANVAS-04 |  |  |  |
| TC-TPL-CANVAS-05 |  |  |  |
| TC-TPL-ACTION-01 |  |  |  |
| TC-TPL-ACTION-02 |  |  |  |
| TC-TPL-CLEAN-01 |  |  |  |
| TC-TPL-CLEAN-02 |  |  |  |
| TC-TPL-API-01 |  |  |  |
| TC-TPL-API-02 |  |  |  |

Verdict rules:

- `PASS`: UI/API behavior matches expected contract.
- `FAIL`: Product exposed an action or state that contradicts backend/API/resource behavior.
- `BLOCKED`: Environment, credentials, provider availability, or resource transitional state prevents a valid conclusion.
- `SKIPPED`: Required template shape does not exist in the catalog or the case is intentionally not applicable.

## 12. Report Template

```markdown
# Template Agent-Friendly Test Report

Date:
Brain URL:
Namespace:
Run id:
Project names:
Template names:

## Summary

- Passed:
- Failed:
- Blocked:
- Skipped:

## Environment

- UI URL:
- API status:
- Template provider status:
- Namespace:

## Cases

### TC-TPL-00

- Status:
- Evidence:
- Notes:

## Failures Only

List only failing or blocked cases here, with the exact UI state, Network status, and resource name.

## Cleanup

- Projects deleted:
- Resources remaining:
- Evidence:
```

