const V4_OPTION_ALLOWLIST = [
  'requestId',
  'request_id',
  'sessionId',
  'surface',
  'spatialContext',
  'regions',
  'selectedCategories',
  'sourcePolicy',
  'skipCache',
  'forceRefresh',
] as const

type V4OptionAllowlistKey = (typeof V4_OPTION_ALLOWLIST)[number]

const V4_OPTION_ALLOWLIST_SET = new Set<V4OptionAllowlistKey>(V4_OPTION_ALLOWLIST)

function isAllowedV4OptionKey(key: string): key is V4OptionAllowlistKey {
  return V4_OPTION_ALLOWLIST_SET.has(key as V4OptionAllowlistKey)
}

export function filterV4ChatOptions(
  options: unknown
): Partial<Record<V4OptionAllowlistKey, unknown>> {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    return {}
  }

  const filtered: Partial<Record<V4OptionAllowlistKey, unknown>> = {}
  const rawOptions = options as Record<string, unknown>

  for (const key of Object.keys(rawOptions)) {
    if (!isAllowedV4OptionKey(key)) continue
    const value = rawOptions[key]
    if (value === undefined) continue
    filtered[key] = value
  }

  return filtered
}

export function buildV4ChatRequestPayload(input: {
  messages: unknown[]
  poiFeatures?: unknown[]
  options?: unknown
}) {
  return {
    messages: Array.isArray(input.messages) ? input.messages : [],
    // V4 后端当前不消费前端透传的 poiFeatures，直接省略大 payload，
    // 由 spatialContext / regions / selectedCategories 驱动空间分析。
    poiFeatures: [],
    options: filterV4ChatOptions(input.options)
  }
}

export default {
  filterV4ChatOptions,
  buildV4ChatRequestPayload
}
