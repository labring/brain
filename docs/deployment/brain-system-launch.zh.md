# brain-system 上线文档

## 基本信息

- 项目：brain-system
- 仓库：https://github.com/labring/brain
- 部署目录：`charts/brain-system`
- 上线命令：`charts/brain-system/install.sh /tmp/brain-system.values.yaml`
- namespace：`brain-system`
- release：`brain-system`
- 负责人：以本次上线单为准

## 上线内容

- `brain-api-staging`
- `brain-ui-staging`
- `brain-registry`
- `whodb`
- `brain-pg`
- Brain v1 项目数据迁移到 Brain v2 项目表，并给存量 K8s 资源补 `brain.io/*` label

## 镜像

- `ghcr.io/labring/brain-api:<tag>`
- `ghcr.io/labring/brain-ui:<tag>`
- `ghcr.io/labring/brain-registry:<tag>`
- `ghcr.io/labring/brain-whodb:<tag>`

镜像由 `.github/workflows/docker-images.yml` 构建，架构为 `linux/amd64`。

## 前置条件

```bash
kubectl get configmap sealos-config -n sealos-system -o jsonpath='{.data.cloudDomain}'
kubectl get ingressclass nginx
kubectl get crd clusters.apps.kubeblocks.io
```

需要的外部配置：

- GitHub App / OAuth
- OpenAI-compatible API 或 Sealos AI proxy
- Devbox token 或 Devbox JWT signing key

## 上线步骤

### 1. 确认镜像 tag

确认 GitHub Actions `Docker Images` workflow 成功，记录本次上线 tag。

如需固定 tag，在 `/tmp/brain-system.values.yaml` 中设置：

```yaml
api:
  image: ghcr.io/labring/brain-api:<tag>
ui:
  image: ghcr.io/labring/brain-ui:<tag>
registry:
  image: ghcr.io/labring/brain-registry:<tag>
whodb:
  image: ghcr.io/labring/brain-whodb:<tag>
```

### 2. 准备 values

```bash
cp charts/brain-system/values.local.example.yaml /tmp/brain-system.values.yaml
```

填写：

- `ui.env.GITHUB_APP_ID`
- `ui.env.GITHUB_APP_PRIVATE_KEY`
- `ui.env.GITHUB_OAUTH_CLIENT_ID`
- `ui.env.GITHUB_OAUTH_CLIENT_SECRET`
- `ui.env.GITHUB_USER_TOKEN_ENCRYPTION_KEY`
- `ui.env.SYSTEM_OPENAI_API_KEY`
- `ui.env.SYSTEM_OPENAI_API_BASE_URL`
- `ui.env.FREE_CHAT_TURNS`
- `ui.env.AI_PROXY_TOKEN_NAME`
- `ui.env.MARKETING_EVENTS_INGEST_SECRET`
- `ui.env.DEVBOX_TOKEN` 或 `ui.env.DEVBOX_JWT_SIGNING_KEY`
- 可选的 `ui.env.DEPLOY_SKILL_SOURCE`；留空时默认使用
  `https://github.com/labring/sealos-skills/tree/brain-deploy`

不要修改已有生产环境的 `GITHUB_USER_TOKEN_ENCRYPTION_KEY`。

GitHub 和 prompt AI 部署固定调用 `sealos-deploy`。如需在 staging 验证
preview 分支，只设置：

```yaml
ui:
  env:
    DEPLOY_SKILL_SOURCE: "https://github.com/labring/sealos-skills/tree/brain-deploy-preview"
```

修改后需要 rollout UI。配置只影响新的部署 runtime；已经安装
`sealos-deploy` 的 Devbox 不会被覆盖。

### 3. 渲染检查

```bash
helm lint charts/brain-system

CLOUD_DOMAIN="$(kubectl get configmap sealos-config -n sealos-system -o jsonpath='{.data.cloudDomain}')"
CLOUD_PORT="$(kubectl get configmap sealos-config -n sealos-system -o jsonpath='{.data.cloudPort}')"

helm template brain-system charts/brain-system \
  -n brain-system \
  -f /tmp/brain-system.values.yaml \
  --set-string "global.cloudDomain=${CLOUD_DOMAIN}" \
  --set-string "global.cloudPort=${CLOUD_PORT}"
```

确认：

- 镜像 tag 正确
- Ingress host 使用目标集群 `cloudDomain`
- `DATABASE_URL` 指向 `brain-pg-conn-credential`
- `brain-pg` 的 `terminationPolicy` 符合预期

### 4. 安装或升级 brain-system

```bash
charts/brain-system/install.sh /tmp/brain-system.values.yaml
```

等待：

```bash
kubectl -n brain-system rollout status deploy/brain-api-staging --timeout=5m
kubectl -n brain-system rollout status deploy/brain-ui-staging --timeout=5m
kubectl -n brain-system rollout status deploy/brain-registry --timeout=5m
kubectl -n brain-system rollout status deploy/whodb --timeout=5m
```

### 5. 确认 v2 数据库 schema 已创建

UI 启动时会执行 `apps/ui/drizzle` 里的 schema migration。迁移 v1 数据前，先确认表存在：

```bash
kubectl -n brain-system get secret brain-pg-conn-credential
```

保持一个终端执行 port-forward：

```bash
kubectl -n brain-system port-forward svc/brain-pg-postgresql 15432:5432
```

另一个终端生成迁移用 `DATABASE_URL`：

```bash
PGUSER="$(kubectl -n brain-system get secret brain-pg-conn-credential -o jsonpath='{.data.username}' | base64 -d)"
PGPASSWORD="$(kubectl -n brain-system get secret brain-pg-conn-credential -o jsonpath='{.data.password}' | base64 -d)"
DATABASE_URL="postgresql://${PGUSER}:${PGPASSWORD}@127.0.0.1:15432/postgres"
```

确认表存在：

```bash
psql "$DATABASE_URL" -c '\dt sealai_project.projects'
```

### 6. 生成 v1 数据迁移清单

先把集群资源分页保存为可续跑的本地快照。此阶段在进程内读取指定 kubeconfig，不启动本地代理或监听端口，只对脚本枚举的集合路径发起 GET，不执行写操作；Secret 只接受 metadata-only 响应：

Instance 集合不使用服务端 labelSelector，避免大型 CRD 存储对标签筛选进行极慢的全量扫描；快照客户端会先在本地筛选 legacy candidate，再保存受限的 Instance metadata/展示字段，后续 inventory 会再次校验候选标签。其他资源集合继续使用服务端标签筛选。

```bash
cd apps/ui

bun scripts/brain-v1-import.mjs snapshot \
  --kubeconfig /path/to/kubeconfig \
  --context <context> \
  --out .migration/brain-v1-all-namespaces

bun scripts/brain-v1-import.mjs inventory \
  --snapshot .migration/brain-v1-all-namespaces/snapshot-v1 \
  --out .migration/brain-v1-all-namespaces

jq '.summary.errors' .migration/brain-v1-all-namespaces/inventory.json
jq '.summary.manualReview' .migration/brain-v1-all-namespaces/classification-report.json
```

两个结果都必须为 `0`。`inventory` 和后续 `dry-run` 都只读本地文件，不再访问集群。V2 不迁移 Devbox；每个候选项目仍以 V1 Template Instance 为锚点，仅含 AP 工作负载或 DB Cluster 的项目会自动进入迁移，其他特殊资源形态进入排除或人工复核报告。

如需处理人工复核项，或排除技术上 eligible 但业务上不需要迁移的项目，按 `classification-report.json` 中的 `projectId` 和 `classificationHash` 另建 `classification-decisions.json`，schema 为 `brain-v1-classification-decisions/v1`，每条 decision 只能是 `include` 或 `exclude`，然后重新生成本地 inventory：

```bash
bun scripts/brain-v1-import.mjs inventory \
  --snapshot .migration/brain-v1-all-namespaces/snapshot-v1 \
  --decisions .migration/brain-v1-all-namespaces/classification-decisions.json \
  --out .migration/brain-v1-all-namespaces
```

旧版 inventory 会被拒绝，不能绕过新的分类规则。

生成 SQL 和 manifest：

```bash
bun scripts/brain-v1-import.mjs dry-run \
  --inventory .migration/brain-v1-all-namespaces/inventory.json \
  --out .migration/brain-v1-all-namespaces
```

审核文件：

- `apps/ui/.migration/brain-v1-all-namespaces/migration.sql`
- `apps/ui/.migration/brain-v1-all-namespaces/migration-manifest.json`
- `apps/ui/.migration/brain-v1-all-namespaces/classification-report.json`

### 7. 执行 v1 数据迁移

```bash
cd apps/ui

bun scripts/brain-v1-import.mjs apply \
  --manifest .migration/brain-v1-all-namespaces/migration-manifest.json \
  --database-url "$DATABASE_URL" \
  --yes
```

迁移会做两件事：

- 写入 `sealai_project.projects`
- 给存量 K8s 资源补 `brain.io/*` label

`apply` 会在连接数据库或修改资源前，仅从本地重新计算 manifest 中 kubeconfig/context 的来源指纹；如果它与生成快照时的来源不一致，命令会直接停止。`rollback` 也执行同样校验，且无来源指纹的旧版 manifest 会被拒绝。校验后的配置及其引用的证书/密钥文件会冻结在内存中，并通过标准输入交给 `kubectl`，既避免执行过程中原文件被替换后改变目标集群，也不会留下含凭据的临时 kubeconfig。

迁移不会删除 v1 的 `cloud.sealos.io/*` label。

### 8. 迁移后检查

检查项目表：

```bash
psql "$DATABASE_URL" -c 'select namespace, id, display_name from sealai_project.projects order by namespace, display_name limit 20;'
```

检查资源 label：

```bash
kubectl get deploy,statefulset,svc,ingress,configmap,pvc,secret -A -l brain.io/managed-by=brain
kubectl get apps.app.sealos.io,clusters.apps.kubeblocks.io,objectstoragebuckets.objectstorage.sealos.io,issuers.cert-manager.io,certificates.cert-manager.io -A -l brain.io/managed-by=brain
```

检查服务：

```bash
kubectl -n brain-system get deploy,pod,svc,ingress,cluster -o wide
kubectl -n brain-system port-forward svc/brain-api-staging-service 9000:9000
curl -fsS http://127.0.0.1:9000/health
```

打开 UI Ingress，确认：

- 项目列表能看到迁移项目
- 项目详情能打开
- AP / DB 列表能正常加载
- GitHub 和 Devbox 入口可用

## 回滚

### 回滚 v1 数据迁移

```bash
cd apps/ui

bun scripts/brain-v1-import.mjs rollback \
  --manifest .migration/brain-v1-all-namespaces/migration-manifest.json \
  --database-url "$DATABASE_URL" \
  --yes
```

### 回滚 Helm release

```bash
helm history brain-system -n brain-system
helm rollback brain-system <revision> -n brain-system --wait --timeout=15m
```

回滚后检查：

```bash
kubectl -n brain-system get deploy,pod,svc,ingress,cluster -o wide
kubectl -n brain-system rollout status deploy/brain-api-staging --timeout=5m
kubectl -n brain-system rollout status deploy/brain-ui-staging --timeout=5m
kubectl -n brain-system rollout status deploy/whodb --timeout=5m
```

不要用 `helm uninstall` 作为常规回滚方式，避免影响 `brain-pg`。

## 通过标准

- Helm install/upgrade 成功
- 四个 Deployment rollout 成功
- API `/health` 成功
- `sealai_project.projects` 有迁移后的项目数据
- 存量资源存在 `brain.io/managed-by=brain`
- UI 能打开迁移后的项目
