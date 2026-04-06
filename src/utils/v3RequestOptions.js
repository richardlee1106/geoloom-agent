const V3_OPTION_ALLOWLIST = new Set([
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
])

export function filterV3ChatOptions(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    return {}
  }

  const filtered = {}
  for (const key of Object.keys(options)) {
    if (!V3_OPTION_ALLOWLIST.has(key)) continue
    const value = options[key]
    if (value === undefined) continue
    filtered[key] = value
  }

  return filtered
}

export default {
  filterV3ChatOptions
}
