# GitHub Deploy + DeepSeek：Codex remote compact v2 因仍走内置 openai provider，整轮被 Fatal 杀掉

> 草稿，目标仓库：[labring/sealos-private](https://github.com/labring/sealos-private)  
> 调查：[Cloud Agent](https://cursor.com/agents/bc-d8549afa-33a0-42c0-93e9-ea2d08e433a2)

建议 labels：`bug` `github-deploy` `codex`

## 问题

GitHub Deploy（Codex managed mode）长会话会在中途整轮失败，Langfuse / Gateway 只留下一条 FATAL：

```
Error running remote compact task: Fatal error: remote compaction v2 expected exactly one compaction output item, got 0 from 3 output items
```

表现：

- 不是某条 shell 命令失败后 Agent 自己收场
- 是 **Codex turn 被 remote compact v2 直接掐死**，没有 `deployment_completed`
- 用户侧看起来像 Agent「突然停了」

生产模型是 DeepSeek（`GITHUB_DEPLOY_MODEL`，现场为 `deepseek-v4-flash`），经 Codex Gateway / OpenAI-compatible 代理接入。

## 现场证据

Langfuse session **`xGuHqdO46aoZ28we`**（2026-09-03，约 07:57–08:12 UTC）

| 项 | 值 |
|---|---|
| namespace | `ns-t8uazqxq` |
| 应用 | Fastify `tiktvstudio` |
| Devbox | `sealai-deploy-864767002fe9bc659db7` |
| trace | `e974b50a549b60442cb1a903b02d0dc1` |
| 致命 observation | `turn-error` @ `2026-09-03T08:12:00.706Z` |
| 构建路径 | 按 skill 走了 Kaniko，镜像已成功 |

这条会话在 compact 之前其实已经走完构建主路径：

1. 第一次 Kaniko Job 因 `limits.memory=8Gi` 撞上 namespace quota 4Gi（已用 1Gi）被拒
2. Agent 把 helper 改成 request 200m/1Gi、limit 1 CPU / 3Gi 后镜像成功：`ghcr.io/marco0820/tiktvstudio@sha256:fde16499…`
3. `template_ready` → `continue`（sha256 `b9bb1383…`）
4. 随后卡在 Template API / kubeconfig（见文末 follow-up），正在处理时 **compact v2 Fatal 结束整轮**

同日另一条会话 **`VlAuvJOmQ6uu4EOr`**（Next 应用 `cscec`，sandbox 200m / 512Mi）是**另一类问题**：Agent 在 Devbox 里跑本地 `next build`，实测峰值远超 512Mi，OOM。**不要和本 issue 的 compact 根因混在一起。**

同类公开报告：[CCX #179](https://github.com/BenedictKing/ccx/issues/179)（`got 0 from 2`，同样 `deepseek-v4-flash`）。

## 发现：这是协议不匹配，不是 Codex 随机崩溃

Codex remote compact **v2**（`codex-rs/core/src/compact_remote_v2.rs`）约定：

1. 往 `/v1/responses` 追加 `{ "type": "compaction_trigger" }`
2. 后端必须返回 **恰好 1 个** `type: "compaction"` 的 output item（加密 compaction blob）

`got 0 from 3` 的含义是：这条 stream **正常结束了，产出了 3 个普通 output item**（典型是 reasoning + message + 额外一项），**其中 compaction item = 0**。

DeepSeek 以及把 Responses 转成 Chat Completions 的代理：

- 不实现 `compaction_trigger`
- 也不会返回 OpenAI 那种 `compaction` item

所以 v2 校验失败 → Fatal → 整轮结束。这是 **provider 协议能力** 问题，不是偶发网络抖动。

## 根因：Brain 改的是 OpenAI 的 base URL，不是 Codex 的 provider 身份

现场很容易误判成「我们已经在用 custom provider / DeepSeek 了」。**没有。**

Brain 注入 Deploy Devbox 的是（`apps/ui/src/features/deploy/task/runner.ts` → `buildCodexGatewayEnv`）：

- `CODEX_GATEWAY_OPENAI_API_KEY`
- `CODEX_GATEWAY_OPENAI_BASE_URL`
- `CODEX_GATEWAY_MODEL`（来自 `GITHUB_DEPLOY_MODEL`）

这只是把 **内置 `openai` provider 的 base URL / key / model 名** 指到 Gateway。
Codex 官方文档也允许用 `openai_base_url` 把内置 openai 指到代理——**副作用是 `is_openai() == true` 仍然成立。**

Codex 是否启用 remote compact v2，看的是 **provider 身份**，不是 model 字符串（`codex-rs/model-provider/src/provider.rs`）：

```rust
if self.info.is_openai() || is_azure_responses_provider(...) {
    RemoteCompactionSupport::V2
} else {
    RemoteCompactionSupport::Unsupported  // 走 local summarize
}
```

Brain 现在写入的 `/codex-home/config.toml`（`buildCodexMcpConfig`）**只有 MCP**：

```toml
# Generated per deployment task. Do not commit.
[mcp_servers.sealai_control]
url = "<DEPLOY_AGENT_MCP_URL>"
required = true
enabled_tools = ["template_ready", "deployment_completed"]
bearer_token_env_var = "SEALAI_DEPLOY_MCP_TOKEN"
startup_timeout_sec = 60
tool_timeout_sec = 60
default_tools_approval_mode = "approve"
```

没有 `model_provider = "..."`，也没有 `[model_providers.*]`。
`CODEX_HOME=/codex-home`，这份 toml 在第一次 Gateway session 之前就会写进去（`runner.ts` prepare 阶段），是改 provider 身份的正确挂钩点。

相关 ADR：[ADR-0069](docs/adr/0069-separate-platform-ai-credentials-and-hand-off-free-chat.md) 只规定 Deploy 注入内部名 `CODEX_GATEWAY_OPENAI_*`，以及 `GITHUB_DEPLOY_MODEL` 与 Chat 模型分离。它**没有**要求把 Codex 继续当成 OpenAI 官方 Responses 后端。默认未配时 Brain 侧是 `gpt-5.5`（`DEPLOY_GATEWAY_MODEL`）；生产用 DeepSeek 后，openai 身份 + DeepSeek 协议能力就对不上了。

## 错误修法（不要做）

只在 openai provider 上设：

```toml
[features]
remote_compaction_v2 = false
```

Codex 会 **回落到 legacy v1 remote compact**（`/v1/responses/compact`）。DeepSeek / 兼容代理同样没有这个接口。问题会从 `got 0 from 3` 变成 v1 compact 失败，**不是**改走 local summarize。

只改 `CODEX_GATEWAY_MODEL` 字符串、或只改 Gateway 的 model 路由，也不会关掉 v2：eligibility 不看模型名。

## 正确修法

改 **provider 身份**，让 Codex 认为这不是 OpenAI，从而 `RemoteCompactionSupport::Unsupported` → **local summarize**。

在现有 `buildCodexMcpConfig` 写出的同一份 `/codex-home/config.toml` 里加上自定义 provider（key 继续走 env，不要写进 toml）：

```toml
model = "<GITHUB_DEPLOY_MODEL>"
model_provider = "github_deploy"

[model_providers.github_deploy]
name = "GitHub Deploy"
base_url = "<已解析的 CODEX_GATEWAY_OPENAI_BASE_URL>"
env_key = "CODEX_GATEWAY_OPENAI_API_KEY"
wire_api = "responses"
requires_openai_auth = false

[mcp_servers.sealai_control]
# 现有 MCP 段保持不变
```

实现要点：

- `buildCodexMcpConfig` 需要拿到 **已经解析好的** `credentials.baseUrl`（以及 model），不要只收 MCP URL
- 继续覆盖 `/codex-home/config.toml`（现在就会覆盖），不要幻想只靠 env 能改掉 `is_openai()`
- 不要用「关 v2 feature flag」当修法

其他可选路径（不在 brain 里、或更重）：

1. sandbox 镜像 `ghcr.io/labring-actions/devbox-runtime-images/sandbox-v1` 在 entrypoint 把 `CODEX_GATEWAY_OPENAI_*` 映射成自定义 provider（Brain 仍应写 toml，避免和镜像抢配置）
2. 若必须保住内置 openai 外壳：Gateway 自己合成 `compaction` SSE。这是协议兼容层，成本和风险都更高，不是首选

## 建议验收

- 一条会触发 compact 的长 GitHub Deploy 会话（DeepSeek）不再出现 `remote compaction v2 expected exactly one compaction output item`
- compact 时走 local summarize，turn 继续，而不是 FATAL
- `/codex-home/config.toml` 里能看到 `model_provider = "github_deploy"`，且 MCP 段仍在
- 关 v2 flag 的「假修法」不要作为合并条件

## Follow-up（本 issue 不修，但同一条会话撞上了）

`xGuHqdO46aoZ28we` 在 compact 之前，Template API 已经在失败：

1. `sealos-api.py` 从 kubeconfig 推 host：`server: https://kubernetes.default.svc` → `template.kubernetes.default.svc` DNS 失败
2. `~/.sealos/auth.json` 的 region `https://usw-1.sealos.io` 能打到真实 Template API
3. 500：`ENOENT` 打开 `/var/run/sealos/kube-api-access/ca.crt`（这条路径只存在于 Devbox，被当成 Template API **服务端** 的 kube 凭证用了）
4. 内联 CA 之后仍 500 `KUBERNETES_ERROR` `details: [object Object]`，server 仍是 `kubernetes.default.svc`
5. Store GET 是通的；Agent 开始想退回 raw kubectl（skill 在 `continue` 之后不希望这样）

根因方向：in-cluster kubeconfig（`kubernetes.default.svc` + in-pod CA 文件路径）不能当 Template API 的 Authorization 材料。建议另开 issue，不要塞进 compact 修复。

## 相关代码（labring/brain）

- `apps/ui/src/features/deploy/task/runner.ts` — `buildCodexGatewayEnv`；prepare 阶段写 config.toml
- `apps/ui/src/features/deploy/task/managed-deployment-contract.ts` — `buildCodexMcpConfig` / `CODEX_MCP_CONFIG_PATH=/codex-home/config.toml`
- `apps/ui/src/features/deploy/task/gateway.ts` — `GITHUB_DEPLOY_MODEL` / 默认 `gpt-5.5`
- `docs/adr/0069-separate-platform-ai-credentials-and-hand-off-free-chat.md`
