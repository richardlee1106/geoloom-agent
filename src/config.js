// 前后端 API Base URL 配置
// 默认情况下，空间/类别链路跟随主后端；
// 只有显式设置 VITE_SPATIAL_*_API_BASE 时才拆分到独立空间后端。
const PROD_AI_API_BASE_DEFAULT = '/proxy-api'
const PROD_SPATIAL_API_BASE_DEFAULT = '/proxy-api'

export function resolveApiBaseUrls(env = {}, isDev = false) {
  const backendVersion = String(env.VITE_BACKEND_VERSION || env.MODE || '').toLowerCase()
  const isV4Mode = backendVersion === 'v4'
  const devAiBaseDefault = isV4Mode ? 'http://127.0.0.1:3210' : 'http://127.0.0.1:3200'
  const devSpatialBaseDefault = isV4Mode ? 'http://127.0.0.1:3210' : 'http://127.0.0.1:3200'

  const aiBase = isDev
    ? (env.VITE_AI_DEV_API_BASE || env.VITE_DEV_API_BASE || devAiBaseDefault)
    : (env.VITE_AI_PROD_API_BASE || env.VITE_PROD_API_BASE || PROD_AI_API_BASE_DEFAULT)

  const spatialBase = isDev
    ? (env.VITE_SPATIAL_DEV_API_BASE || env.VITE_DEV_API_BASE || aiBase || devSpatialBaseDefault)
    : (env.VITE_SPATIAL_PROD_API_BASE || env.VITE_PROD_API_BASE || aiBase || PROD_SPATIAL_API_BASE_DEFAULT)

  return {
    aiBase,
    spatialBase
  }
}

const resolvedApiBases = resolveApiBaseUrls(import.meta.env, import.meta.env.DEV)

export const AI_API_BASE_URL = resolvedApiBases.aiBase
export const SPATIAL_API_BASE_URL = resolvedApiBases.spatialBase

// 兼容旧调用方：默认导出仍表示 AI 基址。
export const API_BASE_URL = AI_API_BASE_URL

export default API_BASE_URL
