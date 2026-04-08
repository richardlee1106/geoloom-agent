type WorkerRequest = {
  category?: string
  categories?: string[]
  name?: string
  bounds?: unknown
  geometry?: unknown
  limit?: number
  baseUrl?: string
}

type WorkerResponse = {
  success?: boolean
  error?: string
  features?: unknown[]
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  return String(error || 'Unknown error')
}

function resolveCategories(category?: string, categories?: string[]): string[] {
  if (Array.isArray(categories) && categories.length > 0) {
    return categories
  }
  return category ? [category] : []
}

// Web Worker 用于从后端 API 加载 POI 数据
self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const {
    category,
    categories,
    name = '',
    bounds,
    geometry,
    limit = 500000,
    baseUrl = ''
  } = event.data

  try {
    // 灵活处理：如果是旧逻辑传了数组 categories，就用数组
    // 如果是新逻辑传了单个 category，就把它放进数组传给后端。
    const finalCategories = resolveCategories(category, categories)

    const response = await fetch(`${baseUrl}/api/spatial/fetch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        categories: finalCategories,
        bounds,
        geometry,
        limit
      })
    })

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }

    const data = await response.json() as WorkerResponse

    if (!data.success) {
      throw new Error(data.error || 'Unknown error')
    }

    // 将结果传回主线程
    self.postMessage({
      success: true,
      name,
      features: Array.isArray(data.features) ? data.features : []
    })
  } catch (error) {
    self.postMessage({
      success: false,
      name,
      error: getErrorMessage(error)
    })
  }
}
