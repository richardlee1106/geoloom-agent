const V3_OPTION_ALLOWLIST = [
  'requestId',
  'request_id',
  'sessionId',
  'clientMetrics',
  'skipCache',
  'forceRefresh',
  'globalAnalysis',
  'selectedCategories',
  'sourcePolicy',
  'spatialContext',
  'regions',
  'analysisDepth'
] as const

type V3OptionAllowlistKey = (typeof V3_OPTION_ALLOWLIST)[number]

const V3_OPTION_ALLOWLIST_SET = new Set<V3OptionAllowlistKey>(V3_OPTION_ALLOWLIST)

function isAllowedV3OptionKey(key: string): key is V3OptionAllowlistKey {
  return V3_OPTION_ALLOWLIST_SET.has(key as V3OptionAllowlistKey)
}

export function filterV3ChatOptions(
  options: unknown
): Partial<Record<V3OptionAllowlistKey, unknown>> {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    return {}
  }

  const filtered: Partial<Record<V3OptionAllowlistKey, unknown>> = {}
  const rawOptions = options as Record<string, unknown>

  for (const key of Object.keys(rawOptions)) {
    if (!isAllowedV3OptionKey(key)) continue
    const value = rawOptions[key]
    if (value === undefined) continue
    filtered[key] = value
  }

  return filtered
}

export default {
  filterV3ChatOptions
}
