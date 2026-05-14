# GeoLoom Agent

`GeoLoom Agent` 是一个独立的 WebGIS + AI 地理分析项目，仓库目录为：

```text
D:\AAA_Edu\geoloom-agent
```

GitHub:

```text
https://github.com/richardlee1106/geoloom-agent
```

项目现在主要分成两条使用路线：

1. `WebGIS Agent`，也就是主路由。
2. `Narrative` 路由，也就是地图解说引擎。

## 1. WebGIS Agent 主路由

主路由地址：

```text
http://127.0.0.1:5173/
```

对应前端入口：

```text
src/MainLayout.vue
```

对应后端 API 前缀：

```text
/api/geo
```

这条路线是完整的 WebGIS Agent 工作台，适合做常规空间问答、地图联动、POI 检索、区域分析和路线距离等任务。

它会拉起完整开发栈：

- 前端 Vite 服务：`http://127.0.0.1:5173`
- 真实依赖适配服务：`http://127.0.0.1:3411`
- 空间编码器服务：`http://127.0.0.1:8100`
- V4 后端服务：`http://127.0.0.1:3210`

启动方式：

```bash
npm run dev:v4
```

Windows 下也可以直接双击或执行：

```bat
start.bat
```

健康检查：

```bash
curl http://127.0.0.1:3210/api/geo/health
```

## 2. Narrative 路由：地图解说引擎

Narrative 路由地址：

```text
http://127.0.0.1:5173/narrative
```

对应前端入口：

```text
src/views/NarrativeShell.vue
src/views/NarrativeMode.vue
```

对应后端 API 前缀：

```text
/api/narrative
```

这条路线是地图解说引擎，面向“把地图内容组织成可播放、可讲述、可追问的空间叙事”。它会根据视野、区域、POI、章节和事实补充，生成类似导览讲解的地图叙事体验。

它启动得更轻，只启动前端和后端：

- 前端 Vite 服务：`http://127.0.0.1:5173`
- Narrative 后端能力：`http://127.0.0.1:3210/api/narrative`

启动方式：

```bash
npm run dev:narrative
```

Windows 下也可以直接双击或执行：

```bat
start_narrative.bat
```

这个入口会先清理 `5173` 和 `3210` 端口，再启动 Narrative 路由，适合快速调试地图解说引擎。

## 安装与准备

首次 clone 后安装依赖：

```bash
npm install
npm --prefix backend install
```

如果是新机器，需要从示例文件生成环境文件：

```bat
copy .env.v4.example .env.v4
copy backend\.env.example backend\.env
```

当前本机仓库已经准备好：

- `.env.v4`
- `backend/.env`

## 常用命令

```bash
# WebGIS Agent 主路由：完整开发栈
npm run dev:v4

# Narrative 地图解说引擎：轻量启动
npm run dev:narrative

# 前后端测试
npm run test

# 构建
npm run build

# preview 栈
npm run start

# 对 dev 栈做 smoke
npm run smoke:dev
```

## 目录速览

```text
src/MainLayout.vue                 WebGIS Agent 主界面
src/views/NarrativeShell.vue       Narrative 路由壳
src/views/NarrativeMode.vue        地图解说引擎主界面
src/views/narrative/               Narrative 前端组件与 API
backend/src/routes/geo.ts          WebGIS Agent API
backend/src/routes/narrative.ts    Narrative API
scripts/cleanup-ports.mjs          启动前端口清理
start.bat                          主路由 Windows 启动入口
start_narrative.bat                Narrative Windows 启动入口
```
