# AP / DB / Template Lifecycle Test Report

执行时间：2026-06-18 10:22-10:45 CST  
仓库：`/Users/jingyang/work/brain`  
关联用例：`docs/agent-friendly-tests/ap-db-template/CORE_RESOURCE_TEST_CASES.md`  
测试方式：CodeGraph 代码查询 + Playwright 浏览器操作 + Network 响应捕获  
范围限制：只补测生命周期，不修复产品代码；测试项目完成后通过 UI 清理。

## 1. Purpose

上一轮报告主要覆盖创建、画布可见性和项目级清理，生命周期类用例大多标记为 `BLOCKED`。本轮专门补测：

- AP Stop / Start / Restart。
- DB Stop / Start / Restart。
- Template 产物的 Stop / Restart 行为。
- 测试项目级清理。

## 2. CodeGraph Basis

本轮先用 CodeGraph 查询生命周期实现和菜单显隐逻辑：

- `packages/api/src/hooks/use-ap-lifecycle.ts`
  - Stop：`PATCH /api/ap/v1alpha1?name=<name>&namespace=<namespace>`，body 等价 `{ spec: { paused: true } }`。
  - Start：同一路径，body 等价 `{ spec: { paused: false } }`。
  - Restart：`POST /api/ap/v1alpha1/restart`。
  - Delete：`DELETE /api/ap/v1alpha1`。
- `packages/api/src/hooks/use-db-lifecycle.ts`
  - Start：`POST /api/db/v1alpha1/start`。
  - Stop：`POST /api/db/v1alpha1/stop`。
  - Restart：`POST /api/db/v1alpha1/restart`。
  - Public access：通过 DB merge patch 更新公开访问配置。
- `apps/ui/src/features/project-canvas/workbench/use-project-canvas.ts`
  - AP / Container 节点在资源状态和鉴权 ready 后注入 `lifecycleActions`。
  - DB 节点在 `dbAuthReady` 后注入 `lifecycleActions` 和 public access toggle。
- `packages/ui/src/components/container-node/container-node.menu-visibility.ts`
  - `Running` 时显示 Stop / Restart / Delete。
  - 停止态应显示 Start / Restart / Delete。
- `packages/ui/src/components/database-node/database-node.menu-visibility.ts`
  - DB 菜单显隐也由状态 tone 控制。

## 3. Environment

- UI：`http://localhost:3000`，通过 `bun --filter @sealai/ui dev` 启动。
- API：`http://localhost:9000`，通过 `bun --filter @sealai/api run` 启动，日志显示 `Server listening on :9000`。
- Namespace：`ns-1y0twy4y`。
- 浏览器入口：`/project` 和各测试 project canvas。

## 4. AP Lifecycle

- Project：`agent-lifecycle-ap-20260618-1022`
- Project ID：`fe211462-2fbb-4000-a34f-9381ba7eeda1`
- Task ID：`CQlxevAOAu7MTBKM`
- AP resource：`ap-yygzdh`
- Image：`nginx:1.27-alpine`
- Public Address：`https://uhviye.192.168.10.189.nip.io/`

执行证据：

| Step         | Result                                                                                                     |
| ------------ | ---------------------------------------------------------------------------------------------------------- |
| 创建 AP      | `POST /api/deploy-tasks => 201`，canvas 出现 AP `ap-yygzdh`。                                              |
| 等待可操作   | 节点从 `Updating` 进入 `Running`。                                                                         |
| Running 菜单 | 显示 `Stop`、`Restart`、`Delete`。                                                                         |
| Restart      | `POST /api/ap/v1alpha1/restart => 200`，body `{ name: "ap-yygzdh", namespace: "ns-1y0twy4y" }`。           |
| Stop         | `PATCH /api/ap/v1alpha1?name=ap-yygzdh&namespace=ns-1y0twy4y => 200`，body `{ spec: { paused: true } }`。  |
| Stop 后菜单  | 显示 `Start`、`Restart`、`Delete`。                                                                        |
| Start        | `PATCH /api/ap/v1alpha1?name=ap-yygzdh&namespace=ns-1y0twy4y => 200`，body `{ spec: { paused: false } }`。 |
| Start 后 UI  | toast 显示 `Started "ap-yygzdh"`，节点进入 `Updating`，符合恢复过程中的中间态。                            |

结论：`TC-AP-02` 改为 `PASS`。

## 5. DB Lifecycle

- Project：`agent-lifecycle-db-20260618-1022`
- Project ID：`13e4b46e-03f9-44a0-b59b-9e68d54f34f5`
- Task ID：`Q9SVSI4pCCGeQqWw`
- DB resource：`db-yursey`
- Engine：MySQL
- Private connection：`mysql://db-yursey.ns-1y0twy4y.svc:3306/mysql`

执行证据：

| Step                 | Result                                                                                           |
| -------------------- | ------------------------------------------------------------------------------------------------ |
| 创建 DB              | `POST /api/deploy-tasks => 201`，canvas 出现 DB `db-yursey`。                                    |
| 等待可操作           | 节点从 `Creating` 进入 `Running`。                                                               |
| Running 菜单         | 显示 `Stop`、`Restart`、`Delete`。                                                               |
| Restart              | `POST /api/db/v1alpha1/restart => 200`，body `{ name: "db-yursey", namespace: "ns-1y0twy4y" }`。 |
| Stop                 | `POST /api/db/v1alpha1/stop => 200`，body `{ name: "db-yursey", namespace: "ns-1y0twy4y" }`。    |
| Stop 后状态          | 节点进入 `Updating`；等待超过 4 分钟仍未出现 Start 菜单。                                        |
| Start                | 未能通过 UI 执行；菜单受 `Updating` 状态 gating，未暴露 Start。                                  |
| Public access toggle | 未执行；DB 停止后长时间处于 `Updating`，不适合作为 public access 变更前置状态。                  |

补充说明：

- 直接在页面里 `fetch('/api/db/v1alpha1/start')` 因没有走产品封装鉴权头返回 `422`，该尝试不计入产品功能失败。
- 有效结论只基于真实 UI 触发的 Network：Restart 和 Stop 均为 `200`，Start 未获得 UI 可操作入口。

结论：

- `TC-DB-02` 记为 `FAIL`：完整的 Stop -> Start -> Restart 生命周期闭环未能由 Agent 通过 UI 完成。
- `TC-DB-03` 记为 `BLOCKED`：public access toggle 因 DB 停止后的长时间 `Updating` 未执行。

## 6. Template-Produced Resource Lifecycle

- Project：`agent-lifecycle-template-20260618-1022`
- Project ID：`db61c36e-44b0-4b58-96ef-6acc27a363e8`
- Task ID：`5mBEXl6HTNJG42BA`
- Template：`AllinSSL`
- Template produced workload：`allinssl-pfbvat`
- Image：`docker.io/allinssl/allinssl:latest`
- Public Address：`https://rpxyypmj.192.168.10.189.nip.io/()(.*)`

执行证据：

| Step               | Result                                                                                                                  |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| 创建 Template 项目 | `POST /api/deploy-tasks => 201`。                                                                                       |
| Canvas 产物        | 初始显示 `template-allinssl-pfbvat`，之后投影为 AP 节点 `ap-allinssl-pfbvat`。                                          |
| Running 菜单       | 显示 `Stop`、`Restart`、`Delete`。                                                                                      |
| Restart            | UI 触发 `POST /api/ap/v1alpha1/restart => 404`，body `{ name: "allinssl-pfbvat", namespace: "ns-1y0twy4y" }`。          |
| Stop               | UI 触发 `PATCH /api/ap/v1alpha1?name=allinssl-pfbvat&namespace=ns-1y0twy4y => 404`，body `{ spec: { paused: true } }`。 |
| Stop 后状态        | 菜单仍为 `Stop`、`Restart`、`Delete`，节点仍为 `Running`。                                                              |

结论：`TC-TPL-04` 记为 `FAIL`。

观察：Template 产物在 UI 中被投影为 AP 节点并暴露 AP 生命周期动作，但 AP lifecycle API 无法解析这个 template-produced workload 名称，返回 `404`。这会让 Agent 看到可点击动作，但无法完成生命周期操作。

## 7. Cleanup

通过 `/project` 列表的 action menu 清理本轮三个测试项目：

- `agent-lifecycle-ap-20260618-1022`
- `agent-lifecycle-db-20260618-1022`
- `agent-lifecycle-template-20260618-1022`

清理后回到 `http://localhost:3000/project` 验证：

| Project                                  | Visible after cleanup | Has action button after cleanup |
| ---------------------------------------- | --------------------- | ------------------------------- |
| `agent-lifecycle-ap-20260618-1022`       | false                 | false                           |
| `agent-lifecycle-db-20260618-1022`       | false                 | false                           |
| `agent-lifecycle-template-20260618-1022` | false                 | false                           |

结论：`TC-CLEAN-01` 本轮 lifecycle 资源清理为 `PASS`。

## 8. Updated Matrix

| TC          | Previous | Lifecycle Addendum                                                       | Current Status |
| ----------- | -------- | ------------------------------------------------------------------------ | -------------- |
| TC-AP-02    | BLOCKED  | Stop / Start / Restart 均通过 UI 执行并返回 200。                        | PASS           |
| TC-DB-02    | BLOCKED  | Restart / Stop 返回 200；Stop 后长时间 `Updating`，Start 菜单未出现。    | FAIL           |
| TC-DB-03    | BLOCKED  | DB 停止后状态未恢复到可安全变更 public access 的状态。                   | BLOCKED        |
| TC-TPL-04   | BLOCKED  | Template-produced AP 暴露 Stop / Restart，但 AP lifecycle API 返回 404。 | FAIL           |
| TC-CLEAN-01 | PASS     | 本轮三个 lifecycle 测试项目均已从项目列表消失。                          | PASS           |

## 9. Final Verdict

生命周期专项结论：

1. AP 生命周期闭环对 Agent 友好，Stop / Start / Restart 都能通过 UI 直接完成。
2. DB 生命周期不是完整闭环：Restart / Stop 可执行，但 Stop 后长时间卡在 `Updating`，Agent 无法继续 Start。
3. Template 产物生命周期存在明显产品问题：UI 暴露 AP 操作，但后端 AP lifecycle endpoint 对 template-produced workload 返回 `404`。
4. 本轮测试资源已通过项目级删除清理完成。

本报告只记录测试结果和风险，不包含任何产品修复。

备注：本文件为误删未跟踪测试产物后恢复的文本版本；截图/JSON 证据文件未恢复。
