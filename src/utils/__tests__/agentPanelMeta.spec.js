import { describe, expect, it } from 'vitest'

import { buildAgentPanelMeta } from '../agentPanelMeta'

describe('buildAgentPanelMeta', () => {
  it('always returns only backend, poi, and category summary chips', () => {
    const meta = buildAgentPanelMeta({
      isOnline: false,
      poiCount: 18,
      selectedCategories: ['餐饮美食', ['生活服务', '咖啡厅']],
    })

    expect(meta).toHaveLength(3)
    expect(meta.map((item) => item.key)).toEqual(['backend', 'poi', 'category'])
    expect(meta[0]).toMatchObject({ label: '后端', value: '离线' })
    expect(meta[1]).toMatchObject({ label: 'POI', value: '18 个' })
    expect(meta[2]).toMatchObject({ label: '类别', value: '餐饮美食 / 咖啡厅' })
  })

  it('falls back to concise empty labels when nothing is selected', () => {
    const meta = buildAgentPanelMeta({
      isOnline: null,
      poiCount: 0,
      selectedCategories: [],
    })

    expect(meta).toEqual([
      expect.objectContaining({ key: 'backend', value: '检测中' }),
      expect.objectContaining({ key: 'poi', value: '未圈选' }),
      expect.objectContaining({ key: 'category', value: '未限定' }),
    ])
  })
})
