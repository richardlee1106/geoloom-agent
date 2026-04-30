type SummaryTone = 'neutral' | 'active' | 'warning'

export interface AgentPanelMetaItem {
  key: 'backend' | 'poi'
  label: string
  value: string
  tone: SummaryTone
}

export function buildAgentPanelMeta({
  isOnline = null,
  poiCount = 0,
}: {
  isOnline?: boolean | null
  poiCount?: number
} = {}): AgentPanelMetaItem[] {
  const resolvedPoiCount = Number.isFinite(Number(poiCount)) ? Number(poiCount) : 0

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
  ]
}
