# AP / DB / Template Agent-Friendly Core Test Cases

本文档面向能操作浏览器或桌面的 Agent。测试目标是用产品真实入口验证 AP、DB、Template 三类核心资源，而不是验证内部实现细节。

## 0. Scope

覆盖范围：

- AP：通过 Docker image 部署产生的 workload / AP 资源。
- DB：通过 Database deployer 创建的 managed database 资源。
- Template：通过 Template deployer 创建的 template deployment task 及其产物。
- AP-DB：通过 AP environment 中的 DB Secret / DSN 证据推导 canvas 连接。

不覆盖范围：

- 不把 `TemplateNative` 当成用户可见资源类型；它只是 template-produced native workload 的内部 projection label。
- 不测试 GitHub OAuth、GitHub repo 推荐模板、AI prompt deployment。
- 不依赖任意 canvas 手动画线作为最终状态；canvas 连接必须来自资源状态。
- 不直接修改数据库数据或生产命名空间。

## 1. Agent Execution Contract

Agent 执行每个用例时必须记录：

- 浏览器 URL。
- 当前 namespace / project display name。
- 使用的资源名、task id、template name、DB engine、Docker image。
- 每一步的可见 UI 结果。
- 若执行了 API / K8s 校验，记录请求路径或命令摘要。
- 清理是否完成。

推荐浏览器自动化顺序：

1. 打开 Brain UI。
2. 确认已登录且能看到 project explorer 或 project canvas。
3. 创建测试 project 时使用唯一后缀，例如 `agent-core-YYYYMMDD-HHMMSS`。
4. 每个资源创建后先等待 toast 或 deploy task 状态，再验证 canvas。
5. 每个 destructive 操作前确认目标名称，避免删错资源。

测试数据建议：

- Docker image：`nginx:1.27-alpine`。
- Docker app listening port：`80`。
- DB engine：优先 `PostgreSQL`；如不可用，依次尝试 `MySQL`、`Redis`、`MongoDB`。
- DB instance preset：`xs`。
- DB replicas：`1`。
- Template：从 UI 的 Template 下拉或 `/api/templates` 中选择第一个 `args` 可被默认值填满，或 required args 数量最少的模板。

## 2. Preflight

### TC-00-01 Open App And Confirm Credentials

Goal: 确认 Agent 可以操作目标 Brain UI，并且产品 API 有 kubeconfig / namespace。

Steps:

1. 打开 Brain UI 首页。
2. 等待 project explorer、canvas、或创建项目入口出现。
3. 若出现登录页，完成已有账号登录流程。
4. 打开浏览器 DevTools network 或使用页面内可见状态，确认没有持续的 unauthorized / missing kubeconfig 错误。
5. 记录当前 namespace。

Expected:

- UI 可进入 project 列表或 canvas。
- 创建项目入口可点击。
- 没有全局 unauthorized、missing kubeconfig、或 namespace missing 阻塞。

Optional API check:

- 请求 `/api/deploy-tasks?projectId=agent-preflight-non-existing-project`，期望得到 JSON，且不是认证错误。

Failure handling:

- 若提示 `Kubeconfig or namespace is missing.`，停止后续创建类用例，记录环境失败。

## 3. AP Core

### TC-AP-01 Create AP From Docker Image

Goal: 通过 Docker image 创建 AP/workload，并验证 deployment task、project、canvas 节点。

Steps:

1. 点击创建项目入口。
2. 选择 `Docker image` 或等价入口。
3. 在 `Docker image` 输入框填入 `nginx:1.27-alpine`。
4. 将 app listening port 设置为 `80`。
5. 若出现 project name 字段，使用 `agent-ap-<timestamp>`。
6. 点击 `Deploy`。
7. 等待 toast 出现 `Created deployment task for project` 或 `Deployment task ... queued.`。
8. 进入新 project canvas。
9. 等待 canvas 上出现 workload / AP 节点。
10. 点击该 AP 节点，打开资源面板。

Expected:

- 部署请求创建 `/api/deploy-tasks` 记录，`source.kind` 为 `docker`，`runner.kind` 为 `direct`。
- project explorer 中出现新项目。
- canvas 中出现 AP/workload 节点。
- AP 节点面板可打开，且至少能看到 settings、metrics、events、history、logs 或 terminal 中的一类 workload 资源视图。

Optional API check:

- `GET /api/deploy-tasks?projectId=<projectId>` 返回对应 projection。
- 若能访问 K8s API，namespace 中存在同名或项目关联的 Deployment / StatefulSet。

Cleanup:

- 保留该 AP，供 AP lifecycle 和 AP-DB 测试复用。

### TC-AP-02 AP Pause Start Restart

Goal: 验证 AP 生命周期动作通过产品 UI 生效。

Preconditions:

- 已完成 `TC-AP-01`。
- AP 节点存在且当前可操作。

Steps:

1. 在 canvas 点击 AP 节点。
2. 打开 AP 操作菜单或资源面板 action 区。
3. 点击 Pause / Stop / Suspend 等暂停动作。
4. 等待 loading toast 完成。
5. 验证 AP 节点状态变为 paused / stopped / inactive，或 replica 变为 0。
6. 点击 Start / Resume。
7. 等待 AP 回到 running / active。
8. 点击 Restart。
9. 等待 restart 成功 toast 或事件更新。

Expected:

- Pause 调用 AP lifecycle PATCH，语义等价于 `spec.paused: true`。
- Start 调用 AP lifecycle PATCH，语义等价于 `spec.paused: false`。
- Restart 调用 AP restart API。
- UI 操作后资源列表刷新，canvas 状态不需要手动刷新页面也能恢复。

Optional API check:

- AP pause/start 使用 `PATCH /api/ap?name=<name>&namespace=<namespace>`。
- AP restart 使用 `POST /api/ap/restart`。

Failure handling:

- 若只读模式导致按钮 disabled，记录 read-only 状态并跳过 destructive lifecycle。

### TC-AP-03 AP Public Access And Network Settings

Goal: 验证 AP 网络入口设置可以改变公开访问状态，并在 canvas 中表现为 public access 相关状态。

Preconditions:

- 已完成 `TC-AP-01`。

Steps:

1. 点击 AP 节点。
2. 打开 Settings 或 Network 面板。
3. 找到 public access / network / port 相关设置。
4. 开启 public access，保存。
5. 等待保存完成和资源刷新。
6. 记录生成的公开地址或入口状态。
7. 关闭 public access，保存。
8. 等待公开入口状态消失或标记为 disabled。

Expected:

- 开启后 AP 节点或资源面板展示公开入口。
- 关闭后公开入口不再作为可用地址展示。
- canvas public access 连接是 presentation-only edge，不应作为用户手工持久化连线。

Optional API check:

- AP network mutation 最终应影响 backing Service / Ingress / Certificate 等 support resources。

### TC-AP-04 AP Delete Confirmation And Canvas Cleanup

Goal: 验证 AP 删除需要输入显示名确认，并清理 AP 与 PublicAccess layout owner。

Preconditions:

- 已完成 AP 创建。
- 若后续 AP-DB 测试还未执行，先不要删除主 AP；可创建一个单独 AP 用于删除测试。

Steps:

1. 点击目标 AP 节点。
2. 点击 Delete action。
3. 确认弹窗标题为 `Delete workload?`。
4. 在确认输入框输入弹窗显示的 AP display name。
5. 点击 `Delete`。
6. 等待删除成功 toast。
7. 刷新资源列表或等待自动刷新。
8. 验证 canvas 中 AP 节点消失。

Expected:

- 删除确认按钮在输入正确 display name 前 disabled。
- 删除调用 `DELETE /api/ap?name=<name>&namespace=<namespace>`。
- AP 节点消失。
- 对应 PublicAccess 节点或 edge 也消失。

## 4. DB Core

### TC-DB-01 Create DB Project

Goal: 通过 Database deployer 创建 DB，并验证 deployment task、project、canvas DB 节点。

Steps:

1. 点击创建项目入口。
2. 选择 `Database`。
3. 在 `Database engine` 中选择 `PostgreSQL`。若不可用，使用 `MySQL`、`Redis`、或 `MongoDB`。
4. 设置 `Instance Preset` 为 `xs`。
5. 设置 `Replicas` 为 `1`。
6. 点击 `Deploy database`。
7. 等待 toast 出现 `Created deployment task for project` 或 `Deployment task ... queued.`。
8. 进入新 project canvas。
9. 等待 DB 节点出现。
10. 点击 DB 节点打开资源面板。

Expected:

- 部署请求创建 `/api/deploy-tasks` 记录，`source.kind` 为 `database`，`runner.kind` 为 `direct`。
- DB engine 只允许当前代码支持的 `mysql`、`postgresql`、`redis`、`mongodb`。
- DB 节点出现在 canvas。
- DB 资源面板可打开。

Optional API check:

- `GET /api/deploy-tasks?projectId=<projectId>` 返回对应 database task projection。
- K8s 中存在对应 KubeBlocks Cluster 或 DB product resource。

Cleanup:

- 保留该 DB，供 DB lifecycle 和 AP-DB 测试复用。

### TC-DB-02 DB Start Stop Restart

Goal: 验证 DB 生命周期操作通过产品 UI 生效。

Preconditions:

- 已完成 `TC-DB-01`。

Steps:

1. 点击 DB 节点。
2. 打开 DB 操作菜单或资源面板 action 区。
3. 点击 Stop。
4. 等待 loading toast 完成。
5. 验证 DB 节点状态变为 stopped / inactive / not ready。
6. 点击 Start。
7. 等待 DB 回到 running / ready。
8. 点击 Restart。
9. 等待 restart 成功 toast 或事件更新。

Expected:

- Stop 调用 DB stop API。
- Start 调用 DB start API。
- Restart 调用 DB restart API。
- UI 根据状态切换 Start / Stop 可见性。

Optional API check:

- DB start 使用 `POST /api/db/start`。
- DB stop 使用 `POST /api/db/stop`。
- DB restart 使用 `POST /api/db/restart`。

### TC-DB-03 DB Public Access Toggle

Goal: 验证 DB public access 可以通过 UI 开启/关闭，并且不会丢失 private connection 信息。

Preconditions:

- 已完成 `TC-DB-01`。
- DB 当前处于 running / ready。

Steps:

1. 点击 DB 节点。
2. 打开 Settings 或 Connection 面板。
3. 记录 private connection。
4. 开启 public access。
5. 等待保存完成和刷新。
6. 记录 public connection / public access 状态。
7. 关闭 public access。
8. 验证 public connection 消失或标记 disabled，private connection 仍存在。

Expected:

- private connection 始终可见。
- public access 开启后显示公开连接入口。
- 关闭后公开入口不再被展示为可用。
- canvas public access 相关状态来自资源投影，不依赖手动画线。

### TC-DB-04 DB Connection String Copyability

Goal: 验证 Agent 可以读取或复制 DB connection string。

Preconditions:

- 已完成 `TC-DB-01`。

Steps:

1. 点击 DB 节点。
2. 打开 Connection 或 Overview 面板。
3. 定位 private connection string。
4. 若 UI 有 copy 按钮，点击 copy。
5. 若浏览器权限允许，读取剪贴板或通过 toast 验证复制成功。

Expected:

- Connection string 文本可见，或有明确 copy 操作。
- 文本包含 engine scheme、service name、namespace、port、database name 等必要信息。

### TC-DB-05 DB Delete Confirmation And Canvas Cleanup

Goal: 验证 DB 删除需要确认，并清理 DB canvas 节点。

Preconditions:

- 已完成 DB 创建。
- 若 AP-DB 测试还未执行，先不要删除主 DB；可创建一个单独 DB 用于删除测试。

Steps:

1. 点击 DB 节点。
2. 点击 Delete action。
3. 在确认弹窗输入 DB display name。
4. 点击确认删除。
5. 等待成功 toast。
6. 验证 DB 节点从 canvas 消失。

Expected:

- 删除确认按钮在输入正确 display name 前 disabled。
- 删除调用 DB delete API。
- DB 节点和相关 public access projection 消失。

## 5. Template Core

### TC-TPL-01 Template Catalog Loads

Goal: 验证 Template 入口可加载模板列表，并展示模板参数。

Steps:

1. 点击创建项目入口。
2. 选择 `Template`。
3. 等待 template catalog 加载。
4. 选择第一个可用模板，优先选择 required args 可由默认值填充的模板。
5. 记录 template name、description、required args。

Expected:

- `GET /api/templates` 返回 200。
- UI 展示至少一个模板。
- 选中模板后展示参数输入。

### TC-TPL-02 Template Required Args Validation

Goal: 验证 Template required args 对 Agent 可理解，且缺失时不能提交。

Preconditions:

- 已完成 `TC-TPL-01`。

Steps:

1. 选中一个有 required args 的模板。
2. 清空一个 required arg。
3. 验证 Deploy 按钮 disabled 或提交后有明确错误。
4. 填回默认值或合法值。
5. 验证 Deploy 按钮可用。

Expected:

- required args 缺失时有清晰 UI 反馈。
- 填写完整后可以提交。

### TC-TPL-03 Create Project From Template

Goal: 通过 Template deployer 创建项目，并验证 task 和 canvas 产物。

Preconditions:

- 已完成 `TC-TPL-01`。
- 模板参数完整。

Steps:

1. 设置 project name 为 `agent-template-<timestamp>`。
2. 点击 Deploy。
3. 等待 deployment task 创建成功。
4. 进入 project canvas。
5. 等待 template-produced resource 出现在 canvas。
6. 记录产物类型、名称、image、public address 或 connection 信息。

Expected:

- 部署请求创建 `/api/deploy-tasks` 记录，`source.kind` 为 `template`，`runner.kind` 为 `template`。
- Canvas 出现模板产物。
- 若模板产物是 workload，Agent 能打开节点面板。

### TC-TPL-04 Template Produced Resource Actions

Goal: 验证 template-produced resource 的可见 action 与实际 API 能力一致。

Preconditions:

- 已完成 `TC-TPL-03`。
- 模板产物处于可操作状态。

Steps:

1. 点击 template-produced resource。
2. 打开 action menu。
3. 记录可见动作。
4. 执行一个非删除生命周期动作，例如 Restart。
5. 若 UI 暴露 Stop/Start，也按资源状态执行一次。
6. 记录 Network 请求和结果。

Expected:

- UI 不应暴露后端无法处理的 action。
- 可见 action 应返回 2xx 或给出清晰错误。
- 若 template 产物被投影为 AP，AP lifecycle API 应能识别该资源；否则 UI 应隐藏 AP lifecycle action。

### TC-TPL-05 Template Project Delete Cleanup

Goal: 验证删除 template-created project 能清理 template task 和产物资源。

Preconditions:

- 已完成 `TC-TPL-03`。

Steps:

1. 返回 project 列表。
2. 对 template-created project 打开 action menu。
3. 点击 Delete。
4. 输入 project display name。
5. 确认删除。
6. 验证 project 从列表消失。

Expected:

- 项目级删除需要名称确认。
- 删除后 project 不再出现在列表。
- 关联 template-produced resource 不再出现在 canvas 或资源查询中。

## 6. AP-DB Linkage

### TC-LINK-01 AP Uses DB Connection Via Env Or Secret

Goal: 验证 AP 可以通过 DB Secret / connection string 形成 AP-DB 关系，并在 canvas 中呈现。

Preconditions:

- 已完成 `TC-AP-01`。
- 已完成 `TC-DB-01`。

Steps:

1. 打开 AP Settings / Environment 面板。
2. 添加环境变量，值引用 DB connection string、DB Secret、或产品提供的 DB binding 控件。
3. 保存 AP 配置。
4. 等待资源刷新。
5. 返回 canvas，观察 AP 与 DB 之间是否出现连接或依赖关系。

Expected:

- AP 配置中能看到 DB connection reference。
- Canvas 连接来自资源状态或 AP env reference，而不是用户手动画线。
- 删除引用后连接应消失。

### TC-LINK-02 Manual Edge Is Not Persisted As Resource Truth

Goal: 验证手动画线不会被误认为资源真实依赖。

Preconditions:

- Canvas 支持手动画线，且已有 AP / DB 节点。

Steps:

1. 在 AP 与 DB 之间手动画线。
2. 刷新页面或重新进入 project。
3. 验证没有资源状态支持的手动画线不会持久化为真实依赖。

Expected:

- 手动画线不应污染资源依赖 truth。
- AP-DB 连接应只由 env/secret/reference 等资源事实生成。

### TC-LINK-03 Remove DB Reference From AP

Goal: 验证移除 AP 中的 DB reference 后 canvas 连接消失。

Preconditions:

- 已完成 `TC-LINK-01`。

Steps:

1. 打开 AP Settings / Environment。
2. 删除 DB connection reference。
3. 保存。
4. 等待资源刷新。
5. 重新进入 canvas。

Expected:

- AP 与 DB 的连接消失。
- DB 本身仍存在。
- AP 其他配置未被误删。

## 7. Task And Layout

### TC-TASK-01 Deployment Task Projection For Three Sources

Goal: 验证 AP、DB、Template 三类创建都能在 deployment task 里看到 source kind 和 project 关联。

Steps:

1. 分别执行 `TC-AP-01`、`TC-DB-01`、`TC-TPL-03`。
2. 对每个 project 请求或观察 task list。
3. 记录 task id、source.kind、runner.kind、target project。

Expected:

- AP：`source.kind=docker`，`runner.kind=direct`。
- DB：`source.kind=database`，`runner.kind=direct`。
- Template：`source.kind=template`，`runner.kind=template`。
- 每个 task 都能关联到对应 project。

### TC-TASK-02 Canvas Layout Survives Refresh

Goal: 验证 Agent 或用户移动节点后，布局刷新后仍稳定。

Preconditions:

- 任一 project canvas 中至少存在两个节点。

Steps:

1. 移动一个节点到明显不同的位置。
2. 等待自动保存或点击保存。
3. 刷新页面。
4. 重新进入该 project。
5. 验证节点位置保持。

Expected:

- 自定义 layout 不被资源刷新覆盖。
- 新增资源 projection 不应破坏已有节点位置。

## 8. Cleanup

### TC-CLEAN-01 Delete All Agent Test Projects

Goal: 清理本轮创建的所有 `agent-*` 测试项目。

Steps:

1. 返回 project 列表。
2. 逐个删除本轮测试项目。
3. 每次删除都输入完整 project display name。
4. 删除完成后刷新列表。
5. 搜索或扫描确认本轮 project name 不再出现。

Expected:

- 所有本轮 `agent-*` 项目从列表消失。
- 删除操作不影响非本轮项目。
- 若资源清理异步执行，记录仍残留的 resource name 和状态。

## 9. Reporting Template

每次执行报告建议使用以下结构：

```md
# AP / DB / Template Agent-Friendly Test Report

执行时间：
仓库：
测试方式：
范围限制：

## Environment

- UI:
- API:
- Namespace:

## Executed Matrix

| TC | Status | Evidence / Reason |
| --- | --- | --- |
| TC-00-01 | PASS/FAIL/BLOCKED | ... |

## Key Evidence

- AP:
- DB:
- Template:
- Cleanup:

## Issues / Observations

1. ...

## Final Verdict

...
```
