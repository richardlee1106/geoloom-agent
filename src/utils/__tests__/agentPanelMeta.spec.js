import { describe, expect, it } from 'vitest'

import { buildAgentPanelMeta } from '../agentPanelMeta'

describe('buildAgentPanelMeta', () => {
  it('returns only backend and poi summary chips', () => {
    const meta = buildAgentPanelMeta({
      isOnline: false,
      poiCount: 18,
    })

    expect(meta).toHaveLength(2)
    expect(meta.map((item) => item.key)).toEqual(['backend', 'poi'])
    expect(meta[0]).toMatchObject({ label: '后端', value: '离线' })
    expect(meta[1]).toMatchObject({ label: 'POI', value: '18 个' })
  })

  it('falls back to concise empty labels when no poi is selected', () => {
    const meta = buildAgentPanelMeta({
      isOnline: null,
      poiCount: 0,
    })

    expect(meta).toEqual([
      expect.objectContaining({ key: 'backend', value: '检测中' }),
      expect.objectContaining({ key: 'poi', value: '未圈选' }),
    ])
  })
})
