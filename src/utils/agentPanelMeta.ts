type SummaryTone = 'neutral' | 'active' | 'warning'

export interface AgentPanelMetaItem {
  key: 'backend' | 'poi' | 'category'
  label: string
  value: string
  tone: SummaryTone
}

function normalizeCategoryLabels(rawSelectedCategories: unknown): string[] {
  if (!Array.isArray(rawSelectedCategories)) return []

  const labels = []
  for (const item of rawSelectedCategories) {
    if (Array.isArray(item) && item.length > 0) {
      const leaf = String(item[item.length - 1] || '').trim()
      if (leaf) labels.push(leaf)
      continue
    }

    const text = String(item || '').trim()
    if (text) labels.push(text)
  }

  return [...new Set(labels)]
}

function buildCategoryValue(selectedCategories: unknown): string {
  const labels = normalizeCategoryLabels(selectedCategories)
  if (labels.length === 0) return '未限定'
  if (labels.length <= 2) return labels.join(' / ')
  return `${labels.length} 类`
}

export function buildAgentPanelMeta({
  isOnline = null,
  poiCount = 0,
  selectedCategories = [],
}: {
  isOnline?: boolean | null
  poiCount?: number
  selectedCategories?: unknown
} = {}): AgentPanelMetaItem[] {
  const resolvedPoiCount = Number.isFinite(Number(poiCount)) ? Number(poiCount) : 0
  const categoryValue = buildCategoryValue(selectedCategories)

  return [
    {
      key: 'backend',
      label: '后端',
      value: isOnline === true ? '在线' : (isOnline === false ? '离线' : '检测中'),
      tone: isOnline === false ? 'warning' : (isOnline === true ? 'active' : 'neutral'),
    },
    {
      key: 'poi',
      label: 'POI',
      value: resolvedPoiCount > 0 ? `${resolvedPoiCount} 个` : '未圈选',
      tone: resolvedPoiCount > 0 ? 'active' : 'neutral',
    },
    {
      key: 'category',
      label: '类别',
      value: categoryValue,
      tone: categoryValue === '未限定' ? 'neutral' : 'active',
    },
  ]
}
