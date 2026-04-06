# GeoLoom Agent Migration Report

日期：2026-04-06

## 1. 从原仓库迁移了哪些关键文件 / 模块

### 前端

从 `D:\AAA_Edu\TagCloud\vite-project` 迁移并保留了完整 UI 框架壳：

- `src/**`
- `public/**`
- `shared/**`
- `index.html`
- `vite.config.js`
- `vitest.config.js`

关键 UI 文件包括：

- `src/MainLayout.vue`
- `src/components/AiChat.vue`
- `src/components/ControlPanel.vue`
- `src/components/MapContainer.vue`
- `src/components/TagCloud.vue`

### 后端

从 `D:\AAA_Edu\TagCloud\vite-project\V4-GeoLoom-beta` 迁移了独立可运行的 V4 后端核心：

- `backend/src/**`
- `backend/tests/**`
- `backend/SKILLS/**`
- `backend/profiles/**`
- `backend/.env.example`
- `backend/package.json`
- `backend/package-lock.json`
- `backend/tsconfig.json`
- `backend/vitest.config.ts`

### 为独立仓库补齐的独立运行能力

- 根目录 `package.json`
- `start.bat`
- `scripts/cleanup-ports.mjs`
- `scripts/run-backend-v4.mjs`
- `scripts/smoke-stack.mjs`
- `.env.example`
- `.env.v4.example`
- `.gitignore`
- `README.md`

另外，当前本地仓库已经直接放好了可运行环境文件：

- `.env.v4`
- `backend/.env`

这两份文件来自原仓库的有效配置拷贝，目的是让当前机器可以直接一键启动，而不是还要再手动复制一次模板。

### 为真实远端依赖补齐的新模块

- `backend/src/dev/realDependencyService.ts`
  用于把真实空间编码器、真实向量检索、真实路由服务整理成独立可启动的适配层
- `scripts/run-backend-v4.mjs`
  默认注入：
  - `SPATIAL_ENCODER_BASE_URL=http://127.0.0.1:8100`
  - `SPATIAL_VECTOR_BASE_URL=http://127.0.0.1:3410`
  - `SPATIAL_VECTOR_HEALTH_PATH=/health/vector`
  - `ROUTING_BASE_URL=http://127.0.0.1:3410`
  - `ROUTING_HEALTH_PATH=/health/routing`

## 2. 哪些内容被有意排除

- 原仓库 V1 / V3 后端与其联动逻辑
- 模型权重、检查点、embedding 产物、缓存、日志
- `node_modules`
- `dist`
- `.env`
- `backend/.tmp-tests`
- `backend/data/memory` 的运行时内容
- 与当前独立 V4 交付无关的原仓库临时调试文件

## 3. 实际运行了哪些测试 / 构建 / 启动命令及结果

### 安装

- `npm install`
  - 结果：成功
- `npm --prefix backend install`
  - 结果：成功

### 环境文件

- `D:\AAA_Edu\geoloom-agent\.env.v4`
  - 结果：已存在
- `D:\AAA_Edu\geoloom-agent\backend\.env`
  - 结果：已存在

说明：

- 当前机器上的独立仓库不是“只给模板”，而是已经准备成可直接运行状态
- 如果换到别的机器重新 clone，再用 `.env.v4.example` 和 `backend/.env.example` 生成本地环境文件即可

### 测试

- `npm run test`
  - 结果：成功
  - 前端：`4` 个测试文件、`8` 个测试全部通过
  - 后端：`36` 个测试文件、`144` 个测试通过、`1` 个跳过

### 构建

- `npm run build`
  - 结果：成功
  - 前端：`vite build --mode v4` 成功
  - 后端：`tsc -p tsconfig.json` 成功

### 一键开发启动

- `npm run dev:v4`
  - 结果：成功
  - 同时拉起：
    - 前端 `http://127.0.0.1:3000`
    - 依赖服务 `http://127.0.0.1:3410`
    - 编码器服务 `http://127.0.0.1:8100`
    - V4 后端 `http://127.0.0.1:3210`

### 真实依赖验证

- `GET http://127.0.0.1:8100/health`
  - 结果：成功
  - 关键值：
    - `encoder_loaded = true`
    - `device = cuda`
    - `models.poi.loaded = true`
    - `models.town.loaded = true`
- `GET http://127.0.0.1:3410/health/vector`
  - 结果：成功
  - 关键值：
    - `database_ready = true`
    - `encoder_ready = true`
- `GET http://127.0.0.1:3410/health/routing`
  - 结果：成功
  - 关键值：
    - `routing_ready = true`
- `GET http://127.0.0.1:3210/api/geo/health`
  - 结果：成功
  - 关键值：
    - `dependencies.spatial_encoder.mode = remote`
    - `dependencies.spatial_vector.mode = remote`
    - `dependencies.route_distance.mode = remote`
    - `degraded_dependencies = ["short_term_memory"]`

### 真实 smoke

- `npm run smoke:dev`
  - 结果：成功
  - 关键输出：
    - `providerReady = true`
    - `remoteModes.spatialEncoder = remote`
    - `remoteModes.spatialVector = remote`
    - `remoteModes.routeDistance = remote`
    - `semanticPoiTop = luckin coffee`
    - `semanticPoiCount = 3`
    - `similarRegionCount = 3`
    - `routeDistanceM = 1683`
    - `queryType = nearby_poi`

## 4. 关于真实 LLM / PostGIS / 空间编码器 / 向量检索 / 路由服务的结论

### LLM

- `provider_ready = true`
- `llm.provider = minimax-anthropic-compatible`
- `llm.model = MiniMax-M2.7`

### PostGIS / PostgreSQL

- `services.database = connected`
- 依赖模式显示为 `database.mode = remote`

### 真实空间编码器

- 通过 `vector-encoder/run.py serve --port 8100` 启动
- `/health` 返回 `encoder_loaded = true`
- 后端健康检查里显示 `spatial_encoder.mode = remote`

### 真实向量检索

- 通过 `backend/src/dev/realDependencyService.ts` 的 `/search/semantic-pois` 与 `/search/similar-regions` 提供
- `npm run smoke:dev` 实测拿到真实结果：
  - `semanticPoiTop = luckin coffee`
  - `similarRegionCount = 3`
- 后端健康检查里显示 `spatial_vector.mode = remote`

### 真实路由服务

- 依赖 OSRM 公共服务 `https://router.project-osrm.org`
- `GET /health/routing` 返回 `routing_ready = true`
- `npm run smoke:dev` 实测 `routeDistanceM = 1683`
- 后端健康检查里显示 `route_distance.mode = remote`

## 5. 与原 vite-project 当前 V4 的实际对比

### 对比方式

为了不改原仓库文件，我使用临时环境变量把原 `V4-GeoLoom-beta` 拉到独立端口：

- 原后端：`http://127.0.0.1:3220`
- 原前端：`http://127.0.0.1:3001`

注入的关键环境变量：

- `SPATIAL_ENCODER_BASE_URL=http://127.0.0.1:8100`
- `SPATIAL_VECTOR_BASE_URL=http://127.0.0.1:3410`
- `SPATIAL_VECTOR_HEALTH_PATH=/health/vector`
- `ROUTING_BASE_URL=http://127.0.0.1:3410`
- `ROUTING_HEALTH_PATH=/health/routing`

### 后端健康状态对比

对比结果：

- 新仓库 `http://127.0.0.1:3210/api/geo/health`
- 原仓库 `http://127.0.0.1:3220/api/geo/health`

两边完全一致：

- `provider_ready = true`
- `services.database = connected`
- `dependencies.spatial_encoder.mode = remote`
- `dependencies.spatial_vector.mode = remote`
- `dependencies.route_distance.mode = remote`
- `degraded_dependencies = ["short_term_memory"]`

### 同一条聊天请求对比

对比请求：

- `POST /api/geo/chat`
- 用户问题：`武汉大学附近适合开什么咖啡店？`

对比结果：

- 两边 `status = 200`
- 两边 `queryType = nearby_poi`
- 两边 `resultCount = 5`
- 两边答案文本一致
- 两边 SSE 事件序列一致：
  - `trace -> job -> stage -> thinking -> intent_preview -> stage -> thinking -> stage -> thinking -> thinking -> stage -> thinking -> stage -> thinking -> stage -> thinking -> stage -> thinking -> pois -> stats -> refined_result -> done`

### 前端契约差异

原仓库前端页面本身可以启动：

- `GET http://127.0.0.1:3001/` 返回 `200`

但原根前端仍保留旧 AI 契约痕迹：

- `GET http://127.0.0.1:3001/api/ai/status` 返回 `404`

说明：

- 原仓库根前端仍带有旧 `/api/ai/*` 调用路径
- 新仓库已经把主联动整理到 `/api/geo/*`
- 所以“后端移植成功”这件事，两边是等价的
- “前端与 V4 后端契约更完整”这件事，新仓库更清晰

### 对比结论

从“新仓库是否成功移植 V4 核心能力”这个标准来看，迁移成功。

从“真实空间编码器 / 真实向量检索 / 真实路由服务是否已经接通”这个标准来看，迁移成功。

从“当前根前端与 V4 契约是否比新仓库更完整”这个标准来看，不是；新仓库更完整。

## 6. 是否还存在对原仓库的隐式依赖

### 代码与路径依赖

结论：已消除。

运行时没有发现仍然依赖 `D:\AAA_Edu\TagCloud\vite-project\...` 的代码调用。

### 仍然必须自行提供的外部条件

这些不属于“依赖原仓库”，而是独立交付时本来就必须存在的外部环境：

- PostgreSQL / PostGIS
- LLM Provider
- 可访问的 OSRM 路由服务
- `vector-encoder` 本地运行时检查点

### 还需要继续消除吗

就“脱离原仓库即可独立交付”这个标准来说，不需要继续消除原仓库隐式依赖。

剩下的是外部运行条件，不是旧仓库路径依赖。

## 7. GitHub 远端状态

- 远端仓库：`https://github.com/richardlee1106/geoloom-agent`
- 本地分支：`main`
- 已执行：
  - `git remote add origin https://github.com/richardlee1106/geoloom-agent.git`
  - `git commit -m "init geoloom-agent"`
  - `git push -u origin main`
