# PRD: Brain 项目运维平台

## 1. 摘要

这份 PRD 定义 Brain 的下一版产品方向。当前代码位于 `sealai` monorepo 中。产品目标是让用户在一个工作区里完成项目资源的创建、部署、查看和运维，包括 Project Canvas、Deployment Task、AP 工作负载、DB 服务、模板、GitHub 仓库和助手驱动的操作。

近期重点不是继续增加更多部署入口，而是把已有部署和运维闭环做可靠。用户应该能发起部署、看懂进度、补充缺失参数、在画布上看到结果，并在失败时快速知道问题在哪里。

## 2. 联系人

| 角色 | 名称 | 说明 |
| --- | --- | --- |
| 产品负责人 | Project owner | 决定产品范围、发布顺序和验收标准。 |
| 工程负责人 | Brain 工程团队 | 负责 Next.js UI、Go API、部署 runner、数据库 schema 和集群集成。 |
| 设计负责人 | 产品设计负责人 | 负责 Project Canvas、任务时间线、侧边面板和资源操作流程。 |
| 主要用户代表 | 内部平台用户 | 验证部署和运维流程是否容易理解。 |
| 平台运维负责人 | 集群/平台负责人 | 验证 runtime、日志、指标、认证和生产发布安全性。 |

## 3. 背景

Brain 当前已经具备一个内部平台的基本形态：

- Project Canvas 展示 AP、DB、AP Public Access、部署占位节点和项目操作面。
- Deployment Task 是 Docker、数据库、模板、GitHub 和助手部署的统一生命周期模型。
- GitHub 部署使用 AI runner，背后依赖 DevBox runtime 和 Codex Gateway。
- Docker、数据库和模板部署使用结构化的确定性 runner。
- Deployment Task Timeline 负责展示用户可理解的进度、阻塞输入、结果卡片、失败详情和 gateway 快照。
- Project 级 deployment projection stream 让画布在部署过程中保持更新。
- Go API 负责 AP、DB、K8s、日志、指标、遥测和编排相关接口。

为什么现在要做：

- 最近的问题说明部署可靠性已经是最大产品风险，包括 build runtime contract 缺口、部署输入缺失、旧失败信息残留、模板工作负载生命周期支持不完整、DB 生命周期卡在中间态、日志 endpoint 配置错误等。
- 当前架构已经有足够核心组件，可以收敛成一个清晰的 v1，而不是继续堆新概念。
- 用户需要在失败时也可信的产品。部署失败时，系统要说明失败步骤、缺少什么输入、下一步能做什么。

## 4. 目标

目标是把 Brain 做成一个可靠的内部项目运维平台，服务需要在 Kubernetes 底座上部署和管理应用栈的用户。

这件事重要，因为用户不想为了理解一次部署在 chat、表单、集群工具、日志和原始 Kubernetes 资源之间来回跳。统一的 Deployment Task 和 Project Canvas 可以减少认知负担，并提升失败恢复效率。

这也符合产品策略：让部署和运维流程更 agent-friendly、更可观测、更可重复。助手可以帮助用户，但任务和项目状态不能依赖助手面板存在。

### 关键结果

1. **部署完成率：** 一个 release 内，Docker、DB、模板和 GitHub 部署路径都创建 Deployment Task，并在至少 95% 的有效测试中到达终态且有 task-owned timeline。
2. **失败清晰度：** 一个 release 内，90% 的失败 Deployment Task 能展示明确的失败步骤、失败摘要和结构化失败详情，不需要用户读取 raw SSE 或进入集群 shell。
3. **输入恢复：** 一个 release 内，100% 因缺少必填输入而阻塞的 Deployment Task 可以从 timeline pane 恢复，并且不丢失之前生成的 artifact。
4. **画布交接：** 两个 release 内，活跃部署在 Project Canvas 上显示稳定占位节点，完成后的资源继承或保留正确位置，正常情况下不发生明显跳动。
5. **生命周期信心：** 两个 release 内，AP 和 DB 生命周期 smoke test 覆盖 create、inspect、restart、stop/start（支持时）、delete 和 cleanup。
6. **运维证据：** 一个 release 内，每个涉及部署、AP、DB、模板、日志或指标的变更都附带聚焦自动化测试或 agent-friendly 手工测试报告。

## 5. 市场细分

### 细分 1：内部应用部署用户

这些用户希望把 Docker image、模板、GitHub repo 或 prompt 变成运行中的项目资源。他们关心速度、清晰进度，以及缺少必填输入时能不能快速恢复。

约束：

- 他们不一定知道 Kubernetes 对象名。
- 他们预期部署结果出现在当前项目里。
- 他们需要有用错误，而不是原始后端事件。

### 细分 2：平台运维用户

这些用户负责诊断失败部署、日志、指标、资源健康和集群集成问题。他们关心结构化证据和安全操作。

约束：

- 他们需要区分应用失败、deployment runner 失败、gateway 失败、API 失败和集群失败。
- 他们需要当前 DB/task/cluster 真实状态，而不是过期 UI 状态。
- 他们需要敏感 runtime 输入被脱敏后的调试数据。

### 细分 3：助手辅助用户

这些用户通过 chat 或生成 UI 创建部署、打开项目操作面。他们需要助手帮助，但产品不能把任务状态藏在 chat transcript 里。

约束：

- 助手可以创建 task，但 Deployment Task 拥有生命周期。
- 用户必须能从 Project Canvas 重新进入任务进度。
- 工具输出和生成部署 UI 必须可解释、可恢复。

## 6. 价值主张

### 任务 1：部署一个项目资源或应用栈

用户可以部署 app、database、template 或 GitHub repo，不需要在割裂的产品流程中切换。每条路径都会变成一个 Deployment Task，带有清晰的 source、target、runner、progress timeline 和结果。

收益：

- 一个部署心智模型。
- 快速 direct runner 和较慢 AI runner 都有清晰状态。
- 减少 chat 输出、runtime 输出和最终资源之间的混淆。

避免的痛点：

- 刷新页面后丢失部署状态。
- artifact 已生成但不知道为什么最终 apply 失败。
- 只缺一个配置却要从头开始部署。

### 任务 2：理解项目里正在运行什么

Project Canvas 给用户一张可视化项目地图，展示 AP、DB、public access、模板可见工作负载和部署占位节点。

收益：

- 项目状态集中可见。
- 用户可以从上下文打开日志、终端、设置和任务时间线。
- 临时部署状态和真实资源有关联，但不会混为一谈。

避免的痛点：

- 在资源列表和原始集群工具之间跳转。
- 部署完成后画布节点跳动。
- 把 support object 当成用户面对的产品资源。

### 任务 3：从部署失败中恢复

Deployment Task Timeline 解释失败步骤、结果资源状态、缺失输入、gateway 状态和结构化失败详情。

收益：

- 更快定位问题。
- 比完整 raw SSE 存储更安全。
- 用户、工程师和运维之间更容易交接。

避免的痛点：

- 只能靠不完整截图排查。
- 阅读原始 gateway stream。
- 只缺配置输入却重复长时间 build。

## 7. 方案

### 7.1 UX 和用户流程

#### 流程 A：创建项目并部署

1. 用户从项目创建、模板部署、Docker 部署、DB 部署、GitHub 部署或助手操作进入。
2. UI 创建带 source、target 和 runner 的 Deployment Task。
3. Task 解析或创建目标 Project。
4. Project Canvas 显示部署占位节点和 Deployment Task Dock 项。
5. 用户打开 task timeline 查看进度。
6. 如果缺少必填输入，timeline 要求补充并恢复 task。
7. 当资源 ready 后，结果卡片变为健康，Project Canvas 把占位节点交接给真实资源。

#### 流程 B：查看和运维资源

1. 用户在 Project Canvas 上选择 AP、DB 或 Public Access 节点。
2. 产品打开正确的侧边面板或主操作面。
3. 用户可以查看 settings、logs、metrics、terminal、DB access 或生命周期操作。
4. 操作更新资源并刷新 canvas，但不创建假的 canvas 状态。

#### 流程 C：诊断失败部署

1. 用户从 Deployment Task Dock 或资源上下文打开任务。
2. Timeline 展示失败步骤、近期事件、结果卡片、阻塞输入和失败摘要。
3. 运维可以查看结构化 failure details 和 gateway state snapshot。
4. 用户可以修复缺失输入，或在支持时重试安全路径。

### 7.2 核心功能

#### 功能 1：统一 Deployment Task 模型

所有部署入口都创建 Deployment Task。一个 task 包含 source、target、runner、status、phase、artifact、timeline、event、blocking input、failure details，以及可用时的 result URL。

v1 支持的 source：

- Docker image。
- Database。
- Template。
- GitHub repository。
- 需要 AI runner 的 prompt 或助手部署。

v1 支持的 runner：

- Direct runner：用于结构化 Docker 和数据库部署。
- Template runner：用于结构化模板部署。
- AI runner：用于 GitHub 和 prompt 部署。

v1 不做：

- 所有部署都强行走 AI。
- 用 GitHub Actions 作为主部署 runner。
- 独立于当前任务表面的完整部署历史中心。

#### 功能 2：Task-owned Deployment Timeline

每个 task 拥有自己的用户可见 timeline。Runner 定义稳定步骤。Timeline 可以展示：

- queued、resolve target、prepare、plan、configure、generate artifacts、apply、verify、completed、failed、cancelled 等状态。
- AP、DB、public access 和模板可见工作负载的结果卡片。
- 阻塞输入表单。
- 失败摘要和结构化失败详情。
- AI runner task 的 gateway state snapshot。

Timeline 不是原始后端日志，也不是 assistant chat。

#### 功能 3：Project Canvas deployment projection

Project Canvas 在任务运行期间显示部署占位节点。它使用 Project 级 deployment projection streaming 和 canvas placement 规则。

目标行为：

- task 创建后快速显示 placeholder。
- 未知部署形态可以先显示一个稳定 placeholder。
- 结构化 artifact 证据可以把 placeholder 细化成 AP、DB、public access 或 template workload slot。
- 真实资源只通过精确 expected identity 或显式 mapping 从 placeholder handoff。
- 用户手动摆放的位置优先于生成位置。

#### 功能 4：AP 和 DB 运维

产品通过项目操作面支持核心 AP 和 DB 操作：

- AP：查看、设置、镜像/版本、环境变量、网络、日志、指标、终端、restart、支持时 stop/start、delete。
- DB：查看、访问、备份、恢复、支持时日志/指标、终端/native client、restart、支持时 stop/start、delete。
- Public access：展示 AP 拥有的公网路由状态，并打开 AP 网络设置。

如果后端不支持模板产出的工作负载生命周期操作，UI 不能暴露这些操作。

#### 功能 5：模板部署和模板可见资源

模板部署使用 deployment-scoped Brain labels，并通过 Kubernetes kind 和资源关系分类产品视图。

产品应该展示：

- 模板选择和参数。
- 模板可见 AP-like workload。
- 模板可见 DB-like workload。
- 来自 Ingress -> Service -> workload 关系的 public access 证据。
- 只在能解释进度时展示 support evidence。

产品不应该把每个渲染出来的 Kubernetes 对象都当成用户面对的资源。

#### 功能 6：GitHub 和助手部署

GitHub 部署使用 AI runner、DevBox runtime 和部署 skill 输出契约。必需输出包括：

- Build result。
- Delivery manifest。
- Template YAML。

最终 apply 读取经过验证的 artifact。partial output progress 可以展示，但不能当作最终成功。

#### 功能 7：可观测性和诊断

产品保存和展示结构化调试数据：

- append-only task events。
- 当前 timeline snapshot。
- artifact summary。
- 脱敏后的 gateway state snapshot。
- failure details。
- 来自 Go API 的 logs 和 metrics。

除非另行批准 retention 和隐私策略，否则 v1 不保存完整 raw SSE。

#### 功能 8：Agent-friendly 测试证据

产品应保留 AP、DB 和 Template 的持久测试目录。每个 case 都应包含 goal、steps、expected result、可选 API check、cleanup 和 failure notes。

### 7.3 技术

当前技术选择：

- `bun@1.3.5` monorepo。
- `apps/ui` 中的 Next.js UI。
- `apps/api` 中的 Go API。
- `packages/ui` 共享 UI 包。
- `packages/api` 共享 API 包。
- Drizzle/Postgres 保存 app-owned deployment 和 layout 数据。
- Kubernetes-backed AP、DB、logs、metrics、terminal 和 orchestration API。
- 基于 React Flow 的 Project Canvas。
- UI app server side 中的 deployment runner。
- AI runner 使用 DevBox 和 Codex Gateway。

技术约束：

- Deployment Task 存储必须属于 deployment domain，不能属于 chat。
- Component registry 不能拥有完整产品 workflow。
- Crossplane 兼容不在范围内。
- Brain ownership labels 必须使用 deployment-scoped labels，不能回到旧 resource-kind labels。
- Public access 属于 AP。AP Public Access Node 只是展示节点。
- Canvas Layout 应成为资源和部署 projection placement 的唯一 placement store。
- 如果只依赖 `drizzle-kit push`，数据库迁移流程还不算 production-grade。

### 7.4 假设

1. 内部用户更喜欢一个统一部署模型，而不是多个 source-specific 流程。
2. 用户可以接受助手帮助，但前提是 task 状态在 chat 外也可见。
3. 结构化 debug fields 足够覆盖大多数 task 失败，v1 不需要保存完整 raw SSE。
4. 模板产出的工作负载可以通过 labels、kind inspection 和 relationship inspection 变得可理解。
5. Go API 继续作为集群操作的长期边界，deployment task orchestration 目前仍留在 app server。
6. 当前 cluster 和 DevBox runtime contract 可以在不替换 runner 架构的前提下稳定到 v1 可用。

## 8. 发布

### 第一版：稳定部署闭环

相对工作量：一个短 release cycle。

包含：

- 保持当前所有部署入口都走 Deployment Task。
- 让 timeline input blocking 和 resume 可靠。
- 让 failure details、artifact summary 和 gateway snapshot 对运维足够可见。
- 让 GitHub output progress 和最终 artifact validation 清晰。
- 保持 Project Canvas deployment dock 和 timeline re-entry 可用。
- 保持 AP、DB 和 template agent-friendly 测试文档更新。
- 修复模板产出的工作负载不支持 AP lifecycle API 时的 UI action 可见性。

不包含：

- 新 cloud provider。
- 完整 deployment history center。
- GitHub Actions deployment runner。
- 完整 raw SSE retention。
- 大范围 design system 重写。

### 第二版：让画布交接和运维更可信

相对工作量：一到两个 release cycle。

包含：

- 完成 owner-based canvas placement 和 deployment projection handoff。
- 让 Project Canvas 在并发部署时保持稳定。
- 扩展 AP 和 DB 生命周期测试。
- 改进 logs 和 metrics surface 的空状态和错误状态。
- 明确模板可见资源支持哪些操作。

### 后续版本：规模化和治理

相对工作量：v1 稳定之后。

包含：

- production-grade 数据库迁移流程。
- task retry policy 和安全 cancellation。
- deployment history 和 audit view。
- 更多模板分类和 source provider。
- 更多 retention、redaction 和 failure analysis 运维控制。
- 如果产品走出内部可信用户范围，再补团队级权限。

## 仍然存在的风险

- AI runner 可靠性依赖 DevBox、gateway、skill output、image build 和最终 apply，其中任何一层都可能失败。
- 模板资源分类比 direct AP/DB 更难，因为 support object 和用户面对的资源共享一个 deployment scope。
- DB 生命周期行为会因 engine 和 provider 状态不同而变化。
- 日志和指标依赖正确的集群 endpoint 配置。
- 如果没有 production migration workflow，deploy-task schema 变更对真实生产数据仍有风险。

## 验收检查

- 有效 Docker image 部署会创建 Deployment Task、展示进度、创建 AP，并在 Project Canvas 上显示 AP。
- 有效 DB 部署会创建 Deployment Task、展示进度、创建 DB node，并支持文档中声明的生命周期操作。
- 有效模板部署会创建 Deployment Task、询问必填参数、应用模板资源，并只展示用户面对的资源。
- 有效 GitHub 部署会创建 Deployment Task、运行 AI runner、记录 output progress、验证 artifact，并应用资源或因缺少输入而阻塞。
- 缺少必填输入时，timeline 会阻塞，并且用户可以提交一次输入且不丢失已生成 artifact。
- 失败 task 会展示失败 timeline step、失败摘要和结构化 failure details。
- Project Canvas 不会用生成的部署位置覆盖用户手动摆放的资源位置。
- 对后端不能执行的资源，UI 会隐藏或禁用不支持的生命周期操作。
