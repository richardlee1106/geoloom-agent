import { SPATIAL_API_BASE_URL } from '../config'

export async function fetchCategoryCatalogTree(fetchImpl = fetch, apiBaseUrl = SPATIAL_API_BASE_URL) {
  const response = await fetchImpl(`${apiBaseUrl}/api/category/tree`)
  if (!response.ok) {
    throw new Error(`Failed to load category catalog (${response.status})`)
  }

  const payload = await response.json()
  return Array.isArray(payload) ? payload : []
}

export default {
  fetchCategoryCatalogTree
}
