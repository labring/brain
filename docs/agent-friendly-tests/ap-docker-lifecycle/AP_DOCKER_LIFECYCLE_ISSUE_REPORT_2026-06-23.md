# AP Docker Lifecycle Issue Report - 2026-06-23

## Summary

本轮只测试 AP Docker image 的创建、配置管理、访问、观测入口和删除清理链路，不修复代码。

- 测试环境：本地 `@sealai/api` on `:9000`，本地 `@sealai/ui` on `:3000`
- namespace：`ns-w2mmuucm`
- project：`agent-ap-docker-main-20260623-1146`
- projectId：`a795e1c5-6aba-472f-8d29-9d7b92b9f15b`
- AP：`ap-wqcjfc`
- image：`nginx:1.27-alpine`
- taskId：`mq8g6mssPImD9hvN`
- 执行时间：`2026-06-23 11:44-11:57 CST`
- 清理状态：AP 已通过产品 UI 删除，项目页显示 `No workloads`

## 有问题

### P1 - AP 日志面板不可用

现象：

- 点击/打开 Logs 后，UI 显示 `Failed to load logs.`
- UI 同时显示 `No pods found.`、`No containers found.`、`No logs available.`
- 网络请求连续返回 500：
  - `GET /api/telemetry/v1alpha1/logs?...kind=ap&name=ap-wqcjfc&namespace=ns-w2mmuucm... => 500 Internal Server Error`

为什么判断为问题：

- 同一个 AP 的 Events 面板能拿到 Pod `ap-wqcjfc-0` 的事件。
- Terminal 能进入同一个 Pod 并执行命令。
- 公开地址能正常访问。
- 因此不是 AP 不存在，也不是 Pod 不存在，而是日志查询链路本身异常。

影响：

- AP Docker 创建成功后，用户无法通过产品日志面板排障。

### P2 - AP 节点快捷按钮存在点击拦截风险

现象：

- Playwright 对可见且 enabled 的 `Open logs` 按钮执行真实点击时失败。
- 错误显示节点内部元素拦截 pointer events：
  - `canvas-node-footer intercepts pointer events`
  - `AP workload span intercepts pointer events`

补充：

- 通过 DOM `el.click()` 可以打开 Logs URL，说明功能入口 handler 存在。
- 真实用户点击是否必现需要人工复核，但自动化真实点击已经捕获到命中区域/层级问题。

影响：

- 用户可能点不到 AP 节点上的日志/观测快捷按钮，尤其在节点缩放或侧栏打开后的布局状态下。

### P2 - AP Logs/Events/Metrics/Terminal 有入口，但节点动作菜单只暴露 Delete

现象：

- 代码层面 AP lifecycle actions 包含 `delete`、`restart`、`start`、`stop`。
- 当前 UI 节点的 `Open workload actions` 菜单只显示 `Delete`。
- 没有看到 `Restart`、`Start`、`Stop/Pause` 等完整生命周期动作入口。

影响：

- “创建管理 docker image 的完整生命周期”中，用户无法从当前可见 UI 完成 AP 的启动/停止/重启验证。
- 这可能是产品 scope 未做，也可能是菜单渲染/权限/状态判断问题，需要产品确认预期。

### P3 - Terminal 默认先尝试 bash，Alpine 镜像会报错后再降级

现象：

- 打开 AP Terminal 后，输出先出现：
  - `/bin/sh: bash: not found`
- 随后 `/bin/sh` 可用，执行 `echo ap-terminal-ok` 返回 `ap-terminal-ok`。

影响：

- 不阻塞终端使用，但对 Alpine/Distroless 镜像体验不好，用户会先看到一条误导性错误。

### P3 - Canvas layout 自动保存出现多次 409

现象：

- AP 创建/选中/布局变化期间，控制台和网络请求出现多次：
  - `PATCH /api/project-canvas/layout => 409 Conflict`

补充：

- 后续也有 `PATCH /api/project-canvas/layout => 200 OK`，没有阻塞 AP 创建和删除。
- 这更像布局并发保存/版本冲突处理问题，不是 AP 本体问题。

影响：

- 用户可能在复杂画布操作中遇到布局保存抖动或控制台错误。

## 没问题

### Docker 创建入口和基础校验正常

已验证：

- 不填 Project Name 时，点击 Docker Image 会提示 `Project name is required.`
- Docker Image 为空时，Deploy 按钮禁用。
- Docker Image 包含空格时，提示 `Docker image must not contain spaces.`
- 端口 `65536` 时，提示 `App Listening Port must be a TCP port from 1 to 65535.`

结论：

- 创建前置校验覆盖了 project name、image 必填/格式、port 范围。

### Docker AP 创建任务正常

已验证创建参数：

- image：`nginx:1.27-alpine`
- command：`nginx`
- args：`-g`, `daemon off;`
- env：
  - `APP_ENV=agent`
  - `FEATURE_FLAG=true`
- config file：
  - path：`/etc/nginx/conf.d/agent.conf`
- storage：
  - path：`/data`
  - size：`1Gi`
- app listening port：`80`

证据：

- `POST /api/deploy-tasks => 201 Created`
- task `mq8g6mssPImD9hvN`
- task status 最终：`completed - completed`
- timeline：
  - `Validate settings` completed
  - `Create resources` completed
  - `Required deployment result resources are running.`
  - `Public Address is accessible.`

### AP 资源规格落地正常

已验证 AP API 响应：

- `spec.input.image = nginx:1.27-alpine`
- `spec.input.command = ["nginx"]`
- `spec.input.args = ["-g", "daemon off;"]`
- `spec.input.env` 包含 `APP_ENV` 和 `FEATURE_FLAG`
- `spec.input.configMaps` 包含 `/etc/nginx/conf.d/agent.conf`
- `spec.input.storage` 包含 `/data`、`1Gi`
- `spec.workload.kind = statefulset`
- `status.phase = Running`
- `status.readyReplicas = 1`
- `status.availableReplicas = 1`

结论：

- 带 PVC/storage 的 Docker AP 正确走 StatefulSet，参数能落到 AP spec。

### 公网访问正常

已验证：

- Public Address：`https://jxgzlm.192.168.10.189.nip.io/`
- curl 返回：
  - `HTTP/2 200`
  - `x-agent-test: ap-docker`
  - body：`agent-ap-docker-v2`

结论：

- 公网地址创建、访问状态、反向代理到 AP 均正常。

### AP 配置更新正常

已验证：

- 在 Settings 面板修改 Config File 内容。
- UI 显示 `Unsaved changes`。
- 点击 `Update AP Settings`。
- 网络请求：
  - `PATCH /api/ap/v1alpha1?name=ap-wqcjfc&namespace=ns-w2mmuucm => 200 OK`
- 更新后 AP spec 中 config file value 已变为带 `X-Agent-Test` header 的版本。
- 公网访问返回新内容 `agent-ap-docker-v2`。

结论：

- AP 设置面板的 config file 更新链路可用，滚动更新后公网访问可反映新配置。

### Events 面板正常

已验证：

- `GET /api/ap/v1alpha1/events?limit=50&name=ap-wqcjfc&namespace=ns-w2mmuucm => 200 OK`
- UI 显示 `14 Items`
- 包含事件：
  - `Pulled`
  - `Created`
  - `Started`
  - `Pulling`
  - `Scheduled`
  - `SuccessfulCreate`
  - `Killing`
  - `SuccessfulDelete`

结论：

- AP 事件查询和展示可用。

### Terminal 可用

已验证：

- `GET /api/project-canvas/terminal-url => 200 OK`
- Terminal 抽屉可打开。
- 执行 `echo ap-terminal-ok` 返回 `ap-terminal-ok`。

结论：

- AP 终端功能可用，但有 bash fallback 体验问题。

### Metrics API 正常返回，但当前没有 telemetry 数据

已验证：

- `POST /api/telemetry/v1alpha1/metrics/snapshot => 200 OK`
- `POST /api/telemetry/v1alpha1/metrics/series => 200 OK`
- UI 显示 `No telemetry`

结论：

- Metrics 接口没有报错；是否应有数据取决于当前测试环境 telemetry 采集能力，不能判定为 AP Docker 生命周期问题。

### 删除清理正常

已验证：

- 节点动作菜单可打开，显示 `Delete`。
- 删除确认框要求输入 `ap-wqcjfc`。
- `DELETE /api/ap/v1alpha1?name=ap-wqcjfc&namespace=ns-w2mmuucm => 200 OK`
- 删除后项目页显示 `No workloads`。

结论：

- AP 删除链路可用，测试 AP 已清理。

## 阻塞 / 未验证

### 未验证：AP Restart / Start / Stop/Pause 生命周期动作

原因：

- 当前 UI 动作菜单只暴露 `Delete`。
- 设置面板和节点快捷按钮未看到 Restart / Start / Stop / Pause 入口。
- 本轮约束是不使用底层破坏性命令或绕过产品 UI/API，所以没有直接调用底层 API 验证。

建议：

- 先确认产品预期：AP 是否应该在节点菜单暴露 Restart / Start / Stop。
- 如果应该暴露，则补 UI 回归测试。
- 如果不应该暴露，则从“完整生命周期”测试清单里移除或标注为 out of scope。

### 未验证：新增/删除多个端口和多个公网地址

原因：

- 本轮优先跑高信号 AP 创建、配置、访问、观测和删除。
- 已验证单端口、单公网地址可用；多端口、多公网地址仍需单独覆盖。

### 未验证：Storage 扩容和删除 PVC 后果

原因：

- 已验证 `/data` + `1Gi` 被创建并绑定。
- 未做扩容/删除 PVC 数据保留测试，避免在共享 namespace 中扩大破坏面。

### 未验证：Env 新增/编辑/删除细项

原因：

- 已验证创建时 env 落地。
- 未逐项验证 settings 面板中的 env action 菜单。

## 证据索引

- 创建任务：
  - `POST /api/deploy-tasks => 201 Created`
  - taskId：`mq8g6mssPImD9hvN`
- AP 资源：
  - name：`ap-wqcjfc`
  - namespace：`ns-w2mmuucm`
  - uid：`9e24a6c8-d263-44cd-88d6-6d8df91a12c3`
  - workload：`statefulset`
  - final running evidence before delete：`status.phase=Running`, `readyReplicas=1`, `availableReplicas=1`
- Public Address：
  - `https://jxgzlm.192.168.10.189.nip.io/`
  - `HTTP/2 200`
  - response body：`agent-ap-docker-v2`
- Config update：
  - `PATCH /api/ap/v1alpha1?name=ap-wqcjfc&namespace=ns-w2mmuucm => 200 OK`
  - configVersionHash changed to `a66f631bbccc426d`
- Logs failure：
  - `GET /api/telemetry/v1alpha1/logs?...name=ap-wqcjfc... => 500 Internal Server Error`
  - UI：`Failed to load logs.`
- Events success：
  - `GET /api/ap/v1alpha1/events?limit=50&name=ap-wqcjfc&namespace=ns-w2mmuucm => 200 OK`
- Terminal success：
  - terminal output：`ap-terminal-ok`
- Delete cleanup：
  - `DELETE /api/ap/v1alpha1?name=ap-wqcjfc&namespace=ns-w2mmuucm => 200 OK`
  - UI：`No workloads`

## 结论

AP Docker 的“创建 -> 参数落地 -> 运行 -> 公网访问 -> 配置更新 -> 事件查看 -> 终端 -> 删除”主链路可用。

当前最需要修的是日志面板：AP 存在、Pod 存在、Events 和 Terminal 都可用，但 Logs API 500，导致 UI 无法排障。其次是 AP 节点快捷按钮的点击命中问题，以及 Restart/Start/Stop/Pause 生命周期动作没有在当前 UI 暴露。
