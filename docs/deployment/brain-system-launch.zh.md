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
- `ui.env.DEVBOX_TOKEN` 或 `ui.env.DEVBOX_JWT_SIGNING_KEY`

不要修改已有生产环境的 `GITHUB_USER_TOKEN_ENCRYPTION_KEY`。

### 3. 渲染检查

```bash
helm lint charts/brain-system

helm template brain-system charts/brain-system \
  -n brain-system \
  -f /tmp/brain-system.values.yaml
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

获取生产 `DATABASE_URL` 后执行：

```bash
psql "$DATABASE_URL" -c '\dt sealai_project.projects'
```

### 6. 生成 v1 数据迁移清单

```bash
cd apps/ui

bun scripts/brain-v1-import.mjs inventory \
  --kubeconfig /path/to/kubeconfig \
  --context <context> \
  --out .migration/brain-v1-all-namespaces

jq '.summary.errors' .migration/brain-v1-all-namespaces/inventory.json
```

`summary.errors` 必须为 `0`。

生成 SQL 和 manifest：

```bash
bun scripts/brain-v1-import.mjs dry-run \
  --inventory .migration/brain-v1-all-namespaces/inventory.json \
  --out .migration/brain-v1-all-namespaces
```

审核文件：

- `apps/ui/.migration/brain-v1-all-namespaces/migration.sql`
- `apps/ui/.migration/brain-v1-all-namespaces/migration-manifest.json`

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

迁移不会删除 v1 的 `cloud.sealos.io/*` label。

### 8. 迁移后检查

检查项目表：

```bash
psql "$DATABASE_URL" -c 'select namespace, id, display_name from sealai_project.projects order by namespace, display_name limit 20;'
```

检查资源 label：

```bash
kubectl get deploy,statefulset,svc,ingress,configmap,secret -A -l brain.io/managed-by=brain
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
