function parseRedisPort(redisUrl) {
  try {
    return Number(new URL(redisUrl).port || '6379')
  } catch {
    return 6379
  }
}

export async function resolveV4RedisUrl(options = {}) {
  const env = options.env || process.env
  const backendEnv = options.backendEnv || {}
  const backendExampleEnv = options.backendExampleEnv || {}
  const hostname = options.hostname || '127.0.0.1'
  const preferredPort = Array.isArray(options.preferredPorts) && options.preferredPorts.length > 0
    ? Number(options.preferredPorts[0])
    : 6379

  return String(
    env.REDIS_URL
    || backendEnv.REDIS_URL
    || backendExampleEnv.REDIS_URL
    || `redis://${hostname}:${preferredPort}`,
  ).trim()
}

export async function ensureV4RedisTargetReady(options = {}) {
  const redisUrl = String(options.redisUrl || '').trim()
  return {
    ready: false,
    started: false,
    reason: 'auto_bootstrap_disabled_in_split_repo',
    redisUrl,
    containerName: null,
    port: redisUrl ? parseRedisPort(redisUrl) : null,
  }
}
