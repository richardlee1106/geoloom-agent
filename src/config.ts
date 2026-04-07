type FrontendEnv = Record<string, string | boolean | undefined>

export interface ApiBaseUrls {
  aiBase: string
  spatialBase: string
}

const PROD_AI_API_BASE_DEFAULT = '/proxy-api'
const PROD_SPATIAL_API_BASE_DEFAULT = '/proxy-api'
const LOCAL_DEV_BASE_RE = /^https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/i

function readEnvValue(env: FrontendEnv, key: string): string {
  return String(env[key] || '').trim()
}

function isTruthyFlag(value: unknown): boolean {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase())
}

function isLocalDevBase(value: unknown): boolean {
  return LOCAL_DEV_BASE_RE.test(String(value || '').trim())
}

export function resolveApiBaseUrls(env: FrontendEnv = {}, isDev = false): ApiBaseUrls {
  const backendVersion = String(env.VITE_BACKEND_VERSION || env.MODE || '').toLowerCase()
  const isV4Mode = backendVersion === 'v4'
  const devAiBaseDefault = isV4Mode ? 'http://127.0.0.1:3210' : 'http://127.0.0.1:3200'
  const devSpatialBaseDefault = isV4Mode ? 'http://127.0.0.1:3210' : 'http://127.0.0.1:3200'
  const directDevApi = isTruthyFlag(env.VITE_DIRECT_DEV_API)

  const rawAiBase = isDev
    ? (readEnvValue(env, 'VITE_AI_DEV_API_BASE') || readEnvValue(env, 'VITE_DEV_API_BASE') || devAiBaseDefault)
    : (readEnvValue(env, 'VITE_AI_PROD_API_BASE') || readEnvValue(env, 'VITE_PROD_API_BASE') || PROD_AI_API_BASE_DEFAULT)

  const rawSpatialBase = isDev
    ? (readEnvValue(env, 'VITE_SPATIAL_DEV_API_BASE') || readEnvValue(env, 'VITE_DEV_API_BASE') || rawAiBase || devSpatialBaseDefault)
    : (readEnvValue(env, 'VITE_SPATIAL_PROD_API_BASE') || readEnvValue(env, 'VITE_PROD_API_BASE') || rawAiBase || PROD_SPATIAL_API_BASE_DEFAULT)

  const shouldPreferSameOriginProxy = isDev
    && !directDevApi
    && isLocalDevBase(rawAiBase)
    && isLocalDevBase(rawSpatialBase)
    && rawAiBase === rawSpatialBase

  return {
    aiBase: shouldPreferSameOriginProxy ? '' : rawAiBase,
    spatialBase: shouldPreferSameOriginProxy ? '' : rawSpatialBase
  }
}

const resolvedApiBases = resolveApiBaseUrls(import.meta.env as FrontendEnv, Boolean(import.meta.env.DEV))

export const AI_API_BASE_URL = resolvedApiBases.aiBase
export const SPATIAL_API_BASE_URL = resolvedApiBases.spatialBase
export const API_BASE_URL = AI_API_BASE_URL

export default API_BASE_URL
