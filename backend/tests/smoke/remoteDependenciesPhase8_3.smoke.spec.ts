import { spawn, type ChildProcess } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'

import { afterAll, describe, expect, it } from 'vitest'

import { loadRuntimeEnv } from '../../src/config/loadRuntimeEnv.js'
import { RemoteFirstFaissIndex } from '../../src/integration/faissIndex.js'
import { RemoteFirstOSMBridge } from '../../src/integration/osmBridge.js'
import { RemoteFirstPythonBridge } from '../../src/integration/pythonBridge.js'
import { RedisShortTermStore } from '../../src/memory/RedisShortTermStore.js'
import { ShortTermMemory } from '../../src/memory/ShortTermMemory.js'

const runtimeEnv = loadRuntimeEnv()
const devV4Module = await import(
  new URL('../../../scripts/lib/dev-v4.js', import.meta.url).href
) as {
  ensureV4RedisTargetReady: (options?: {
    rootDir?: string
    redisUrl?: string
    logger?: Console
  }) => Promise<{
    ready: boolean
    started: boolean
    reason: string | null
    redisUrl: string
    containerName: string | null
    port: number | null
  }>
  resolveV4RedisUrl: (options?: {
    env?: NodeJS.ProcessEnv
    backendEnv?: Record<string, string | undefined>
    backendExampleEnv?: Record<string, string | undefined>
    preferredPorts?: number[]
    hostname?: string
  }) => Promise<string>
}
const {
  ensureV4RedisTargetReady,
  resolveV4RedisUrl,
} = devV4Module

const DEFAULT_DEPENDENCY_BASE_URL = 'http://127.0.0.1:3411'
const DEFAULT_SPATIAL_ENCODER_BASE_URL = 'http://127.0.0.1:8100'

function normalizeBaseUrl(value: string | undefined, fallback: string) {
  return String(value || fallback).trim().replace(/\/+$/u, '')
}

async function fetchHealth(baseUrl: string, timeoutMs = 2000) {
  try {
    const response = await fetch(`${baseUrl}/health`, {
      signal: AbortSignal.timeout(timeoutMs),
    })

    if (!response.ok) {
      return null
    }

    return response.json()
  } catch {
    return null
  }
}

async function waitForHealth(baseUrl: string, {
  timeoutMs = 30_000,
  intervalMs = 500,
}: {
  timeoutMs?: number
  intervalMs?: number
} = {}) {
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    const payload = await fetchHealth(baseUrl, Math.max(1000, intervalMs * 3))
    if (payload) {
      return payload
    }

    await delay(intervalMs)
  }

  return null
}

function startDependencyAdapter(rootDir: string) {
  return spawn(process.execPath, ['scripts/v4-dependency-adapter.mjs'], {
    cwd: rootDir,
    env: {
      ...process.env,
      V4_VECTOR_WARMUP_DELAY_MS: '0',
    },
    stdio: 'ignore',
    windowsHide: true,
  })
}

async function bootstrapRemoteDependencies() {
  const adapterBaseUrl = normalizeBaseUrl(
    process.env.SPATIAL_VECTOR_BASE_URL || process.env.ROUTING_BASE_URL,
    DEFAULT_DEPENDENCY_BASE_URL,
  )
  const encoderBaseUrl = normalizeBaseUrl(
    process.env.SPATIAL_ENCODER_BASE_URL,
    DEFAULT_SPATIAL_ENCODER_BASE_URL,
  )

  let adapterProcess: ChildProcess | null = null
  let adapterHealth = await waitForHealth(adapterBaseUrl, {
    timeoutMs: 1500,
    intervalMs: 250,
  })

  if (!adapterHealth && adapterBaseUrl === DEFAULT_DEPENDENCY_BASE_URL) {
    adapterProcess = startDependencyAdapter(runtimeEnv.rootDir)
    adapterHealth = await waitForHealth(adapterBaseUrl, {
      timeoutMs: 30_000,
      intervalMs: 500,
    })
  }

  const encoderHealth = await waitForHealth(encoderBaseUrl, {
    timeoutMs: adapterHealth ? 30_000 : 1500,
    intervalMs: 500,
  })

  const redisUrl = await resolveV4RedisUrl({
    env: process.env,
    hostname: '127.0.0.1',
  })
  const redisSetup = await ensureV4RedisTargetReady({
    rootDir: runtimeEnv.rootDir,
    redisUrl,
    logger: console,
  })

  if (adapterHealth) {
    process.env.SPATIAL_VECTOR_BASE_URL = adapterBaseUrl
    process.env.ROUTING_BASE_URL = adapterBaseUrl
  }

  if (encoderHealth) {
    process.env.SPATIAL_ENCODER_BASE_URL = encoderBaseUrl
  }

  if (redisSetup.ready && redisSetup.redisUrl) {
    process.env.REDIS_URL = redisSetup.redisUrl
  }

  return {
    redisReady: redisSetup.ready === true,
    vectorReady: Boolean(adapterHealth),
    routingReady: Boolean(adapterHealth),
    encoderReady: Boolean(encoderHealth),
    cleanup: async () => {
      if (!adapterProcess || adapterProcess.killed) {
        return
      }

      adapterProcess.kill('SIGTERM')
      await delay(500)

      if (!adapterProcess.killed) {
        adapterProcess.kill('SIGKILL')
      }
    },
  }
}

const dependencyBootstrap = await bootstrapRemoteDependencies()
const redisReady = dependencyBootstrap.redisReady
const vectorReady = dependencyBootstrap.vectorReady
const routingReady = dependencyBootstrap.routingReady
const encoderReady = dependencyBootstrap.encoderReady

afterAll(async () => {
  await dependencyBootstrap.cleanup()
})

describe('Phase 8.3 remote dependency smoke', () => {
  it.skipIf(!redisReady)('promotes short-term memory to remote mode when Redis is configured', async () => {
    const store = new RedisShortTermStore({
      url: String(process.env.REDIS_URL),
      keyPrefix: `v4:smoke:${Date.now()}:`,
      connectTimeoutMs: Number(process.env.REDIS_CONNECT_TIMEOUT_MS || '2000'),
    })
    const memory = new ShortTermMemory({
      ttlMs: 60_000,
      store,
    })

    await memory.appendTurn('phase83_smoke_session', {
      traceId: 'phase83_smoke_trace',
      userQuery: '武汉大学附近有哪些咖啡店？',
      answer: 'Redis remote smoke',
      createdAt: new Date().toISOString(),
    })

    const snapshot = await memory.getSnapshot('phase83_smoke_session')
    expect(snapshot.turns).toHaveLength(1)
    await expect(memory.getStatus()).resolves.toMatchObject({
      name: 'short_term_memory',
      mode: 'remote',
      degraded: false,
    })
  })

  it.skipIf(!vectorReady)('reaches the remote FAISS service when configured', async () => {
    const index = new RemoteFirstFaissIndex()

    const candidates = await index.searchSemanticPOIs('武汉大学附近咖啡店', 3)
    expect(Array.isArray(candidates)).toBe(true)
    await expect(index.getStatus()).resolves.toMatchObject({
      name: 'spatial_vector',
      mode: 'remote',
      degraded: false,
    })
  })

  it.skipIf(!routingReady)('reaches the remote routing service when configured', async () => {
    const bridge = new RemoteFirstOSMBridge()

    const route = await bridge.estimateRoute([114.364339, 30.536334], [114.355, 30.54], 'walking')
    expect(route.distance_m).toBeGreaterThan(0)
    await expect(bridge.getStatus()).resolves.toMatchObject({
      name: 'route_distance',
      mode: 'remote',
      degraded: false,
    })
  })

  it.skipIf(!encoderReady)('reaches the remote Python encoder when configured', async () => {
    const bridge = new RemoteFirstPythonBridge()

    const encoded = await bridge.encodeText('武汉大学附近咖啡店')
    expect(encoded.dimension).toBeGreaterThan(0)
    await expect(bridge.getStatus()).resolves.toMatchObject({
      name: 'spatial_encoder',
      mode: 'remote',
      degraded: false,
    })
  })
})
