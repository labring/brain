# Changelog

All notable changes to Brain are documented in this file.

## [2.0.4] - 2026-08-04

### 新增

- Assistant 新增受保护的 Project 管理能力，支持列出、查看、预览删除和删除
  Project；删除前需要用户确认，并记录操作审计信息。
- 新增 Brain GTM 埋点，覆盖模块浏览、部署创建、部署开始、部署删除和资源卡片
  操作；通过 `GTM_ID` 可选开启。
- 部署任务 Dock 移入顶部栏，并根据可用宽度自动折叠到溢出菜单。
- Side Pane 新增固定底部操作区，部署提交、设置保存和部署任务生命周期操作可
  保持在可见位置。

### 改进

- 个人资源现在使用全局 `userUid` 作为身份归属，覆盖 GitHub 连接和 Assistant
  会话；历史数据会在用户首次访问时自动迁移，并支持身份指纹和账号合并处理。
- 部署任务新增超时策略，超时后提供明确且可恢复的失败状态。
- 模板部署支持更完整的参数控件和选项，并在模板目录刷新后保留已填写的参数、
  原始模板 YAML 及 Sealos 模板 DSL。
- 可通过 `DEPLOY_SKILL_SOURCE` 配置部署 Skill 的分支或来源。
- 弹性伸缩设置重新整理目标指标和切换控件，统一交互反馈和视觉层级。
- 优化项目创建、项目列表、日志查看器和资源设置等界面的操作反馈与控件样式。

### 修复

- 修复 Project 删除确认流程，确保删除预览完整、目标一致，并拒绝过期或篡改的
  删除请求。
- 修复模板恢复部署中的敏感字段处理、模板声明状态和资源身份一致性问题。
- 修复 Side Pane 和顶部栏在 React Compiler 检查下的兼容性问题。
- 修复图标按钮悬停时颜色被 Tooltip 状态错误触发的问题，并统一日志实时控制的
  图标尺寸和项目列表固定按钮的悬停样式。

### 升级说明

- 必须执行 UI 数据库迁移 `0008`、`0009` 和 `0010`。
- 生产环境 UI 必须配置 `JWT_INTERNAL`，其值应与 Sealos Desktop 使用的集群共享
  应用令牌密钥一致；未配置时服务会拒绝启动。
- 确认 Sealos Desktop 会为请求提供应用令牌。缺少、无效或已因账号合并失效的
  令牌，将无法访问 Assistant、GitHub 连接及 GitHub 来源的部署操作。
- `GTM_ID` 为可选配置；未配置时不发送 GTM 事件。
- 旧版 GitHub 连接和 Assistant 会话会在用户首次访问时自动迁移，无需人工迁移
  数据。

## [2.0.3] - 2026-07-29

### Added

- Added optional `DEPLOY_SKILL_SOURCE` configuration for testing another
  `sealos-deploy` source in staging while retaining the production
  `brain-deploy` source by default.

### Changed

- AI Deployment Timelines now show stable, meaningful progress messages,
  coalesce repeated updates, and retain safe resource status and timeout
  events.
- Sealos Template configuration now displays trusted canonical keys, labels,
  descriptions, choices, and non-sensitive defaults. Submitted values and
  sensitive defaults remain hidden and are never persisted.

### Removed

- Removed the outdated Chinese product operations guide.

### Fixed

- Fixed AI deployment configuration rendering generic unlabeled fields or
  treating internal blocker IDs as user-facing submission keys.
- Legacy AI tasks whose input metadata cannot be safely projected now fail
  closed into a redeployable state instead of remaining blocked indefinitely.

### Upgrade Notes

- No database migration is required. Existing installations only need to roll
  out the UI image for these changes.
- `DEPLOY_SKILL_SOURCE` is optional. Changing it requires a UI rollout and
  affects only new deployment runtimes; Devboxes where `sealos-deploy` is
  already installed are not overwritten.

## [2.0.2] - 2026-07-28

### Added

- New Projects now receive meaningful Display Names derived from their
  deployment source. Name collisions are resolved with numeric suffixes, and
  case-insensitive uniqueness is enforced by the database.
- Added an isolated worktree launcher for running multiple local development
  environments with separate ports and generated configuration.

### Changed

- VictoriaLogs credentials are now loaded from static API process environment
  variables instead of Kubernetes Secrets during each request.
- Increased Assistant reasoning effort for more reliable Project operations.

### Fixed

- Removed the 110-second Assistant stream deadline so long-running operations,
  including cold Devbox starts, can complete without being interrupted.
- Restored background Devbox warmup when opening a Project and skipped warmup
  cleanly when Devbox integration is not configured.
- Prevented stale or out-of-order deployment projection events from regressing
  task state, resurrecting purged tasks, or leaving event streams frozen after
  a failed PostgreSQL subscription.
- Fixed terminal startup when kubeconfig values contain whitespace or
  characters that require encoding before WebSocket initialization.
- Fixed AP telemetry pod matching so similarly prefixed workloads no longer
  contribute metrics to one another.
- Refused database restores that would overwrite an existing connection Secret
  not owned by the restore target.
- Fixed PostgreSQL table detection for quoted identifiers, including mixed-case
  names, spaces, and embedded quotes.

### Upgrade Notes

- `VMAUTH_SECRET_NAMESPACE` and `VMAUTH_SECRET_NAME` are no longer used. Set
  `VLSELECT_USERNAME` and `VLSELECT_PASSWORD` on the API process when
  VictoriaLogs requires authentication, then restart or roll out the API.
- The Project migration enforces case-insensitive Display Name uniqueness. If
  existing names differ only by case, the earliest Project keeps its name and
  later Projects receive the lowest available numeric suffix.

## [2.0.1] - 2026-07-24

### Added

- Added direct Template deployment from `/deploy` URLs. Valid links can prefill
  Template inputs, create a Project, and start deployment without asking the
  user to enter the same configuration again.
- Added on-demand PostgreSQL System Objects in DB Access, keeping system schemas
  and tables hidden until requested.
- Added a Chinese product operations guide covering current product behavior,
  limitations, and support workflows.

### Changed

- Database connection strings are now masked in the Canvas and Settings UI and
  fetched only when a user explicitly reveals or copies them. Regular database
  read responses no longer include decoded credentials.
- GitHub deployment tasks now use the initiating user's AI Proxy credentials
  instead of platform OpenAI credentials and fail closed when those credentials
  cannot be resolved.
- Deployment failures now expose stable, actionable reasons. Deployment
  timelines, artifacts, AI events, and Gateway updates use explicit public
  projections that omit runtime locators, secrets, and untrusted fields.
- A blocked deployment now means that explicit user input is required. Invalid
  blockers are rejected, user input is validated against the authoritative
  request, and historical invalid blocked tasks can recover as failed tasks.
- GitHub Connections and Assistant Conversations are now bound to the verified
  Workspace Actor derived from the request kubeconfig. Deployment credential
  ownership is preserved across collaborative task actions and resolved again
  for redeployments.
- New deployment Devboxes use a `10Gi` storage limit by default. Existing and
  resumed Devboxes are not resized.
- GitHub disconnect now asks for confirmation, and authorization always opens
  the GitHub account picker so users can switch accounts deliberately.
- Updated the Sealos Skills installation command to use
  `labring/sealos-skills`.
- Added repository-wide CI checks for formatting, type checking, and linting.

### Fixed

- Recovered Assistant conversations left with incomplete browser-tool results
  after reloads, disconnects, timeouts, or interrupted streams.
- Serialized Assistant turns with owner-scoped leases and guarded persistence
  so overlapping or replayed requests cannot overwrite newer conversation
  history.
- Hid the free-turn counter and showed the transition notification immediately
  when the final free Assistant turn is consumed.
- Fixed the Desktop Home action reopening Brain instead of remaining on Sealos
  Desktop.
- Fixed modal dialogs opened from a Side Pane or Session Drawer causing the
  Project Canvas to refocus unexpectedly.
- Improved public-address links, container image copy actions, Template creation
  icons, and GitHub repository list controls.
- Improved off-cluster local Kubernetes development while keeping production
  requests pinned to in-cluster API coordinates and trust roots.

### Security

- Personal GitHub and Assistant resources can no longer be selected through
  client-provided user or connection identifiers inside a shared namespace.
- Deployment data returned to the UI is scrubbed on both write and read paths;
  unknown event kinds and fields fail closed.
- Database credentials are no longer amplified through normal Canvas and
  project polling responses.

### Upgrade Notes

- The Workspace Actor migration is forward-only. It clears existing GitHub
  Connections, pending GitHub authorization sessions, and Assistant
  Conversations because their verified owners cannot be inferred safely.
  Users must reconnect GitHub and start new Assistant conversations after the
  upgrade.
- Deploy the UI with a maintenance window or a `Recreate` rollout so old and new
  authorization routes never run concurrently. The bundled Helm values now use
  `Recreate` for the UI deployment.

## [2.0.0] - 2026-07-16

Brain v2's first generally available release brought application deployment,
databases, and day-to-day operations into one Project workspace.

### Added

- Added Project creation from GitHub repositories, container images, databases,
  and application Templates.
- Added a unified deployment timeline for tracking progress, providing required
  configuration, diagnosing failures, canceling, and redeploying.
- Added application, database, and public-access management to Project Canvas.
- Added logs, metrics, terminals, and image history, together with database
  access, backup, and restore workflows.
- Added Project Assistant for understanding the current Project context and
  starting supported operations.

[2.0.3]: https://github.com/labring/brain/compare/v2.0.2...v2.0.3
[2.0.4]: https://github.com/labring/brain/compare/v2.0.3...v2.0.4
[2.0.2]: https://github.com/labring/brain/compare/v2.0.1...v2.0.2
[2.0.1]: https://github.com/labring/brain/compare/v2.0.0...v2.0.1
[2.0.0]: https://github.com/labring/brain/releases/tag/v2.0.0
