# GeoLoom Agent

`GeoLoom Agent` 是从 `D:\AAA_Edu\TagCloud\vite-project` 拆出来的独立 V4 仓库，目标不是“裁一个能亮的 demo”，而是把完整前端 UI 框架壳、V4 后端、真实空间依赖联调脚本、测试和构建链路一起迁出来，做到可以单独维护、单独测试、单独上传 GitHub。

当前本地独立仓库目录：

- `D:\AAA_Edu\geoloom-agent`

## 这次到底保留了什么

前端不是轻量化面板，而是保留了完整 UI 框架壳：

- `src/MainLayout.vue`
- `src/components/AiChat.vue`
- `src/components/ControlPanel.vue`
- `src/components/MapContainer.vue`
- `src/components/TagCloud.vue`
- `src/views/**`
- `public/**`
- `shared/**`

后端保留的是独立可运行的 V4 核心：

- `backend/src/**`
- `backend/tests/**`
- `backend/SKILLS/**`
- `backend/profiles/**`
- `backend/.env.example`

另外补上了独立仓库真正需要的编排脚本：

- `scripts/cleanup-ports.mjs`
- `scripts/run-backend-v4.mjs`
- `scripts/smoke-stack.mjs`
- `start.bat`

## 一键启动现在是什么

Windows 下直接：

```bat
start.bat
```

或者：

```bash
npm run dev:v4
```

这条命令会先清理旧进程，再同时启动 4 个服务：

- 前端：`http://127.0.0.1:3000`
- 真实依赖适配服务：`http://127.0.0.1:3410`
- 空间编码器服务：`http://127.0.0.1:8100`
- V4 后端：`http://127.0.0.1:3210`

如果你习惯以前的 `stack` 叫法，也可以继续用：

```bash
npm run dev:stack
```

## 安装与准备

先安装 Node 依赖：

```bash
npm install
npm --prefix backend install
```

前端环境文件：

```bash
copy .env.v4.example .env.v4
```

后端环境文件：

```bash
copy backend\.env.example backend\.env
```

如果你希望新仓库尽量复现原仓库当前 V4 的本地效果，最直接的做法是把原 `V4-GeoLoom-beta/.env` 中有效的数据库和 LLM 配置同步到 `backend/.env`。这个文件不会被提交。

## 真实空间依赖怎么接

这次不是只把前后端迁出来，而是把真实链路也补齐了：

- `vector-encode` 提供真实空间编码器服务
- `geoloom-agent/backend/src/dev/realDependencyService.ts` 提供真实向量检索和真实路由服务适配层
- `scripts/run-backend-v4.mjs` 会给 V4 后端注入默认远端地址

默认连接关系如下：

- `SPATIAL_ENCODER_BASE_URL=http://127.0.0.1:8100`
- `SPATIAL_VECTOR_BASE_URL=http://127.0.0.1:3410`
- `SPATIAL_VECTOR_HEALTH_PATH=/health/vector`
- `ROUTING_BASE_URL=http://127.0.0.1:3410`
- `ROUTING_HEALTH_PATH=/health/routing`

也就是说，`dev:v4` 起来后，后端看到的不是本地 mock，而是真实 remote 依赖模式。

## 怎么检查是不是“真的接上了”

先看后端总健康：

```bash
curl http://127.0.0.1:3210/api/geo/health
```

看下面这些字段：

- `provider_ready`
- `services.database`
- `dependencies.spatial_encoder.mode`
- `dependencies.spatial_vector.mode`
- `dependencies.route_distance.mode`
- `degraded_dependencies`

再看依赖侧健康：

```bash
curl http://127.0.0.1:8100/health
curl http://127.0.0.1:3410/health/vector
curl http://127.0.0.1:3410/health/routing
```

## 我这次实际验证了什么

2026-04-06 我在这个独立仓库里重新实跑了这些命令：

```bash
npm run test
npm run build
npm run dev:v4
npm run smoke:dev
```

实际结果：

- 前端测试：`4` 个文件、`8` 个测试全部通过
- 后端测试：`36` 个文件、`144` 个测试通过、`1` 个跳过
- 构建：前端 `vite build --mode v4` 成功，后端 `tsc -p tsconfig.json` 成功
- `GET /api/geo/health`：`spatial_encoder / spatial_vector / route_distance` 都是 `remote`
- `npm run smoke:dev`：只剩 `short_term_memory` 处于 degraded

这次 smoke 的关键输出是：

- `remoteModes.spatialEncoder = remote`
- `remoteModes.spatialVector = remote`
- `remoteModes.routeDistance = remote`
- `semanticPoiTop = luckin coffee`
- `similarRegionCount = 3`
- `routeDistanceM = 1683`

## 和原 vite-project 对比后的结论

我额外把原仓库 V4 也拉起来做了同条件对照，结果是：

- 原 V4 后端在注入同样的远端编码器 / 向量 / 路由地址后，`/api/geo/health` 和新仓库一致，三条真实依赖都能显示 `remote`
- 对同一条问题 `武汉大学附近适合开什么咖啡店？`，原仓库 V4 后端和新仓库返回的 SSE 事件序列、`queryType`、`resultCount` 和答案内容一致
- 原仓库根前端当前仍然保留旧 `/api/ai/*` 契约，因此 `GET /api/ai/status` 会返回 `404`
- 新仓库已经把主联动对齐到 `/api/geo/*`，这一点比原根前端更干净

所以更准确的结论是：

- `geoloom-agent` 已经成功移植 V4 核心能力
- 真实空间编码器、真实向量检索、真实路由服务都能在新仓库里跑成 remote 模式
- 新仓库在前端契约和一键启动体验上，比原仓库当前根前端更完整

## 有意排除的内容

为了让仓库适合上传 GitHub，这些内容是故意不带的：

- `node_modules`
- `dist`
- `.env`
- 模型权重、检查点、embedding 产物
- 运行时缓存、日志、coverage、临时文件
- 原仓库 V1 / V3 后端

## 常用命令

```bash
# 一键开发
npm run dev:v4

# 同上，保留 stack 命名
npm run dev:stack

# 前后端测试
npm run test

# 构建
npm run build

# preview 栈
npm run start

# 对 dev 栈做真实 smoke
npm run smoke:dev
```

## 配套说明

- 详细迁移清单、排除项、命令结果和对照结论见 `MIGRATION_REPORT.md`
- 真实空间编码器仓库见 `D:\AAA_Edu\vector-encode`
