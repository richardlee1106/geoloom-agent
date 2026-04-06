import { SPATIAL_API_BASE_URL } from '../config'

const categoryCatalogPromiseCache = new Map()

export async function fetchCategoryCatalogTree(fetchImpl = fetch, apiBaseUrl = SPATIAL_API_BASE_URL, options = {}) {
  const cacheKey = String(apiBaseUrl || '')
  const forceRefresh = options?.forceRefresh === true

  if (!forceRefresh && categoryCatalogPromiseCache.has(cacheKey)) {
    return categoryCatalogPromiseCache.get(cacheKey)
  }

  const requestPromise = (async () => {
    const response = await fetchImpl(`${apiBaseUrl}/api/category/tree`)
    if (!response.ok) {
      throw new Error(`Failed to load category catalog (${response.status})`)
    }

    const payload = await response.json()
    return Array.isArray(payload) ? payload : []
  })()

  categoryCatalogPromiseCache.set(cacheKey, requestPromise)

  try {
    return await requestPromise
  } catch (error) {
    categoryCatalogPromiseCache.delete(cacheKey)
    throw error
  }
}

export function resetCategoryCatalogTreeCache() {
  categoryCatalogPromiseCache.clear()
}

export default {
  fetchCategoryCatalogTree,
  resetCategoryCatalogTreeCache,
}
