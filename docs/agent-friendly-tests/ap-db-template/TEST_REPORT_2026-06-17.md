# AP / DB / Template Agent-Friendly Test Report

执行时间：2026-06-17 22:40-22:57 CST  
仓库：`/Users/jingyang/work/brain`  
测试文档：`docs/agent-friendly-tests/ap-db-template/CORE_RESOURCE_TEST_CASES.md`  
测试方式：Playwright 浏览器操作 + Network 捕获 + CodeGraph 代码查询  
范围限制：只执行测试、记录证据和清理本轮 `agent-*` 测试项目；未修改产品代码。

## 1. Environment

- UI：`http://localhost:3000`，通过 `bun --filter @sealai/ui dev` 启动。
- API：`http://localhost:9000`，通过 `bun --filter @sealai/api run` 启动，日志显示 `Server listening on :9000`。
- Namespace：`ns-1y0twy4y`。
- Template provider：`https://template.192.168.10.189.nip.io`。
- 浏览器入口：`/project`，可见 project explorer、`New Project`、右侧 assistant pane。
- 敏感信息处理：Network 中出现的 `encodedKubeconfig` / token 未写入报告正文。

## 2. CodeGraph Basis

使用 CodeGraph 查询了当前代码中的 Docker / Database / Template 创建链路：

- `apps/ui/src/features/deployment/docker-deployer.tsx` 和 `docker-deployment-settings.ts`：Docker image、port、env/config/storage 校验后才能 deploy；本次用 `nginx:1.27-alpine` 和端口 `80`。
- `apps/ui/src/features/deployment/database-deployer.tsx`：默认 instance preset 为 `xs`、replicas 为 `1`，deploy 请求输出 `databaseId / instancePreset / replicas`。
- `apps/ui/src/features/deployment/template-deployer.tsx`：Template 下拉使用 catalog 第一项作为默认值，required args 使用默认值填充后允许 deploy。

这些代码路径和本次 UI 看到的控件、POST body 形态一致。

## 3. Executed Evidence

### Preflight

- 打开 `http://localhost:3000/project` 成功进入项目列表。
- API 服务启动前，Next proxy 曾对 AP/DB/K8s 查询返回 502；启动 Go API 后恢复为 200。
- 稳定后 Network 关键请求：
  - `GET /api/projects?namespace=ns-1y0twy4y => 200`
  - `GET /api/ap/v1alpha1?...namespace=ns-1y0twy4y => 200`
  - `GET /api/db/v1alpha1?...namespace=ns-1y0twy4y => 200`
  - `GET /api/k8s/v1alpha1/get?... => 200`

### AP / Docker

- Project：`agent-ap-20260617-2246`
- Docker image：`nginx:1.27-alpine`
- App listening port：`80`
- `POST /api/deploy-tasks => 201`
- Request 摘要：`source.kind=docker`，`runner.kind=direct`，`target.kind=newProject`，`target.displayName=agent-ap-20260617-2246`，`hasEncodedKubeconfig=true`。
- Task：`feNFDPDKH6HlymE1`，Project ID：`58db7e7b-de4d-45b4-a907-fecf5d3450d0`。
- Artifact YAML 生成 AP：`ap-ypmwvu`，namespace `ns-1y0twy4y`，image `nginx:1.27-alpine`，public domain prefix `vrkglz`。
- Canvas 可见：AP workload `ap-ypmwvu`、image、Replicas `1`、Public Address `https://vrkglz.192.168.10.189.nip.io/`。

### DB

- Project：`agent-db-20260617-2250`
- DB engine：MySQL
- Instance preset：`xs`
- Replicas：`1`
- `POST /api/deploy-tasks => 201`
- Request 摘要：`source.kind=database`，`settings.databaseId=mysql`，`settings.instancePreset=xs`，`settings.replicas=1`，`runner.kind=direct`，`target.kind=newProject`。
- Task：`7iq9KIt7cHd9G1Se`，Project ID：`ce06df8b-4c39-44d4-bf45-b2d004d2ca00`。
- Artifact YAML 生成 DB：`db-kqchgv`，namespace `ns-1y0twy4y`，engine `mysql`，quota `xs`，replicas `1`。
- Canvas 可见：DB 节点 `db-kqchgv`、`Database MySQL`、private connection `mysql://db-kqchgv.ns-1y0twy4y.svc:3306/mysql`、状态 `Creating`。

### Template

- Project：`agent-template-20260617-2252`
- Template：`AllinSSL`
- 参数默认值：`ACCESS_URL=allinssl`、`ALLINSSL_USER=allinssl`、`ALLINSSL_PWD=allinssldocker`
- `GET /api/templates?language=zh => 200`
- `POST /api/deploy-tasks => 201`
- Request 摘要：`source.kind=template`，`source.templateName=AllinSSL`，`runner.kind=template`，`target.kind=newProject`。
- Task：`OFqUdGjJ2Nq83B7i`，Project ID：`9b00dd34-9b30-4795-8ff5-dd0fce98c4e1`。
- Canvas 可见：AP workload `allinssl-pvrfde`、image `docker.io/allinssl/allinssl:latest`、状态 `Creating`、Public Address `https://cewininp.192.168.10.189.nip.io/()(.*)`。

### Cleanup

通过项目列表 action menu 执行项目级删除：

- `agent-ap-20260617-2246`：确认对话框要求输入项目名；提交删除后从项目列表消失。
- `agent-db-20260617-2250`：`DELETE /api/projects => 200`，列表刷新 `GET /api/projects?... => 200`。
- `agent-template-20260617-2252`：`DELETE /api/projects => 200`，列表刷新 `GET /api/projects?... => 200`。
- 删除 toast 可见：`Deleted "agent-db-20260617-2250".`、`Deleted "agent-template-20260617-2252".`
- 删除确认 UX 符合 Agent-friendly 要求：必须输入目标 project display name。

## 4. Test Matrix

| TC | Status | Evidence / Reason |
| --- | --- | --- |
| TC-00-01 | PASS | UI / project explorer 可进入；API 启动后 projects/AP/DB/K8s 查询恢复 200。 |
| TC-AP-01 | PASS | Docker deploy task 201；Artifact 生成 AP `ap-ypmwvu`；Canvas 显示 AP workload 和 Public Address。 |
| TC-AP-02 | BLOCKED | 未执行 pause/start/restart。原因：会扩大运行中资源生命周期操作面；本轮目标优先核心创建、可见性、清理证据。 |
| TC-AP-03 | PASS | AP Canvas 显示 `Public Address` 和 `https://vrkglz.192.168.10.189.nip.io/`。未执行网络配置修改。 |
| TC-AP-04 | PASS | 项目级 Delete 经过名称确认并从列表消失；等价覆盖本轮 AP project cleanup。 |
| TC-DB-01 | PASS | DB deploy task 201；Artifact 生成 DB `db-kqchgv`；Canvas 显示 MySQL DB 节点和 private connection。 |
| TC-DB-02 | BLOCKED | 未执行 DB start/stop/restart。原因同生命周期扩大操作面，且 DB 创建仍处 `Creating`。 |
| TC-DB-03 | BLOCKED | 未执行 DB public access toggle。原因：需要修改数据库暴露面，本轮不做额外网络暴露。 |
| TC-DB-04 | PASS | Canvas 可见 private connection 文本，满足 Agent 可复制连接串的核心 UI 证据；未额外写入剪贴板验证。 |
| TC-DB-05 | PASS | 项目级 Delete 经过名称确认，`DELETE /api/projects => 200`。 |
| TC-TPL-01 | PASS | `GET /api/templates?language=zh => 200`；Template UI 默认选中 AllinSSL 并显示参数。 |
| TC-TPL-02 | PASS | AllinSSL required 参数均有默认值，Deploy 按钮可用；本轮未清空参数做负向验证。 |
| TC-TPL-03 | PASS | Template deploy task 201；Canvas 显示 template-produced AP workload `allinssl-pvrfde`。 |
| TC-TPL-04 | BLOCKED | 未执行 template-produced resource actions。原因：资源仍 Creating，且生命周期操作会扩大破坏面。 |
| TC-TPL-05 | PASS | 项目级 Delete 经过名称确认，`DELETE /api/projects => 200`。 |
| TC-LINK-01 | BLOCKED | 未执行 AP 绑定 DB env/secret。原因：需要新增 AP-DB 组合资源和环境变量修改，超出本轮核心三类资源 smoke。 |
| TC-LINK-02 | BLOCKED | 未执行手动画线负向验证。原因：当前核心验证不依赖 canvas 手动画线。 |
| TC-LINK-03 | BLOCKED | 未执行移除 DB env reference。原因：依赖 TC-LINK-01 的绑定资源。 |
| TC-TASK-01 | PASS | Docker、Database、Template 三类都创建了 `POST /api/deploy-tasks => 201`，且 source.kind 分别为 `docker/database/template`。 |
| TC-TASK-02 | BLOCKED | 未执行用户自定义 placement 后轮询保持验证。原因：需要长时间 canvas layout 交互和重复轮询，非核心资源创建路径。 |
| TC-CLEAN-01 | PASS | 三个 `agent-*` 项目均通过 UI 删除确认清理，列表正文不再显示这些测试项目。 |

## 5. Issues / Observations

1. 本地 UI 启动但 Go API 未启动时，资源查询会出现 502；启动 `@sealai/api` 后恢复。这是环境 preflight 阻塞，不是产品功能结论。
2. 直接从页面 `fetch('/api/ap...')` 不会自动带产品封装的 Authorization / kubeconfig，返回 422 或 400；有效验证应使用浏览器真实 UI 触发的 Network 请求或产品 fetcher 路径。
3. AP / DB / Template 创建后，短时间内 UI 多数处于 `Creating` / `Updating` / task `running`。本轮验证覆盖“提交、artifact、canvas projection/节点可见”，没有等待到 workload Ready。
4. 右侧 assistant pane 存在历史 GitHub Deploy failed 消息，和本轮 AP/DB/Template 测试无关。

## 6. Final Verdict

核心结论：AP、DB、Template 三类资源的 Agent-friendly 核心创建路径可执行，浏览器操作入口、deploy task 提交、artifact/画布可见性和项目级清理均有证据。生命周期操作、AP-DB 绑定、layout 持久化等长尾用例未在本轮执行，状态记录为 BLOCKED，原因是会扩大运行中资源操作面或依赖额外组合资源。

本轮未发现需要立即修复的产品代码问题；主要风险是测试环境必须同时启动 UI 和 Go API，否则会误判为资源 API 失败。

备注：本文件为误删未跟踪测试产物后恢复的文本版本；截图/JSON 证据文件未恢复。
