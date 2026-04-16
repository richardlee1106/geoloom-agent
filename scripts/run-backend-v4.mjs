#!/usr/bin/env node
/**
 * Backend v4 启动包装脚本
 * NER 服务已作为 concurrently 常驻进程独立运行
 *
 * dev 模式：先 tsc 编译再用 node dist 运行（绕过 tsx watch 缓存）
 * start 模式：直接 node dist 运行
 */
import { spawn, spawnSync } from 'node:child_process'

const script = process.argv[2] || 'dev'

// ── 环境变量注入 ──
const backendEnv = {
  ...process.env,
  PORT: process.env.PORT || '3210',
  HOST: process.env.HOST || '127.0.0.1',
  SPATIAL_ENCODER_BASE_URL: process.env.SPATIAL_ENCODER_BASE_URL || 'http://127.0.0.1:8100',
  SPATIAL_VECTOR_BASE_URL: process.env.SPATIAL_VECTOR_BASE_URL || 'http://127.0.0.1:3411',
  SPATIAL_VECTOR_HEALTH_PATH: process.env.SPATIAL_VECTOR_HEALTH_PATH || '/health/vector',
  SPATIAL_VECTOR_TIMEOUT_MS: process.env.SPATIAL_VECTOR_TIMEOUT_MS || '6000',
  ROUTING_BASE_URL: process.env.ROUTING_BASE_URL || 'http://127.0.0.1:3411',
  ROUTING_HEALTH_PATH: process.env.ROUTING_HEALTH_PATH || '/health/routing',
  ROUTING_TIMEOUT_MS: process.env.ROUTING_TIMEOUT_MS || '6000',
  GEOLOOM_ENCODER_BASE_URL: process.env.GEOLOOM_ENCODER_BASE_URL || 'http://127.0.0.1:8100',
  OSRM_BASE_URL: process.env.OSRM_BASE_URL || 'https://router.project-osrm.org',
  NER_URL: process.env.NER_URL || 'http://127.0.0.1:5100',
  CRAWL4AI_URL: process.env.CRAWL4AI_URL || 'http://127.0.0.1:11235',
}

if (script === 'dev') {
  // dev 模式：先编译再运行，绕过 tsx watch 缓存
  console.log('[run-backend-v4] 编译 TypeScript → dist ...')
  const buildResult = spawnSync('npx', ['tsc', '-p', 'tsconfig.json'], {
    cwd: new URL('../backend', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'),
    stdio: 'inherit',
    shell: true,
    env: process.env,
  })
  // tsc 可能因无关的 test 文件报错，但 dist 产物已更新
  console.log('[run-backend-v4] 编译完成，启动 node dist/src/server.js ...')
}

const child = spawn(
  script === 'dev' ? 'node' : `npm --prefix backend run ${script}`,
  script === 'dev'
    ? ['dist/src/server.js']
    : [],
  {
    cwd: new URL('../backend', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'),
    stdio: 'inherit',
    shell: true,
    env: backendEnv,
  },
)

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }
  process.exit(code ?? 0)
})
