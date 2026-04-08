import { SPATIAL_API_BASE_URL } from '../config'

type CategoryCatalogNode = unknown

interface FetchCategoryCatalogOptions {
  forceRefresh?: boolean
}

type FetchCategoryCatalog = (
  input: string
) => Promise<{
  ok: boolean
  status: number
  json: () => Promise<unknown>
}>

const categoryCatalogPromiseCache = new Map<string, Promise<CategoryCatalogNode[]>>()

function normalizeApiBaseUrl(apiBaseUrl: unknown): string {
  return String(apiBaseUrl || '').replace(/\/+$/, '')
}

export async function fetchCategoryCatalogTree(
  fetchImpl: FetchCategoryCatalog = fetch,
  apiBaseUrl: unknown = SPATIAL_API_BASE_URL,
  options: FetchCategoryCatalogOptions = {}
): Promise<CategoryCatalogNode[]> {
  const normalizedApiBaseUrl = normalizeApiBaseUrl(apiBaseUrl)
  const cacheKey = normalizedApiBaseUrl
  const forceRefresh = options.forceRefresh === true

  if (!forceRefresh && categoryCatalogPromiseCache.has(cacheKey)) {
    return categoryCatalogPromiseCache.get(cacheKey) as Promise<CategoryCatalogNode[]>
  }

  const requestPromise = (async () => {
    const response = await fetchImpl(`${normalizedApiBaseUrl}/api/category/tree`)
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

export function resetCategoryCatalogTreeCache(): void {
  categoryCatalogPromiseCache.clear()
}

export default {
  fetchCategoryCatalogTree,
  resetCategoryCatalogTreeCache
}
