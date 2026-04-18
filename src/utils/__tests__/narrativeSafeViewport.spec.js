import { describe, expect, it } from 'vitest'

import { buildNarrativeSafePixelBounds } from '../narrativeSafeViewport'

describe('buildNarrativeSafePixelBounds', () => {
  it('左侧脚本面板应推动安全区左边界右移', () => {
    const bounds = buildNarrativeSafePixelBounds({
      mapWidth: 1280,
      mapHeight: 720,
      overlays: [{ left: 24, top: 24, right: 404, bottom: 696 }],
      padding: 24,
      gap: 18,
      minWidth: 320,
      minHeight: 220,
    })

    expect(bounds).toEqual({
      left: 422,
      top: 24,
      right: 1256,
      bottom: 696,
    })
  })

  it('左右两侧都被遮挡时应收窄为中间可见带', () => {
    const bounds = buildNarrativeSafePixelBounds({
      mapWidth: 1440,
      mapHeight: 900,
      overlays: [
        { left: 24, top: 24, right: 384, bottom: 780 },
        { left: 1110, top: 180, right: 1390, bottom: 720 },
      ],
      padding: 24,
      gap: 20,
      minWidth: 320,
      minHeight: 220,
    })

    expect(bounds).toEqual({
      left: 404,
      top: 24,
      right: 1090,
      bottom: 876,
    })
  })

  it('顶部横向遮挡应下推安全区 top', () => {
    const bounds = buildNarrativeSafePixelBounds({
      mapWidth: 1024,
      mapHeight: 768,
      overlays: [{ left: 240, top: 16, right: 784, bottom: 120 }],
      padding: 24,
      gap: 16,
      minWidth: 320,
      minHeight: 220,
    })

    expect(bounds).toEqual({
      left: 24,
      top: 136,
      right: 1000,
      bottom: 744,
    })
  })

  it('左上脚本面板和左下工具按钮共存时应选取面积更大的连续可见区', () => {
    const bounds = buildNarrativeSafePixelBounds({
      mapWidth: 1024,
      mapHeight: 560,
      overlays: [
        { left: 12, top: 16, right: 246, bottom: 208 },
        { left: 16, top: 448, right: 76, bottom: 532 },
      ],
      padding: 24,
      gap: 18,
      minWidth: 320,
      minHeight: 120,
    })

    expect(bounds).toEqual({
      left: 264,
      top: 24,
      right: 1000,
      bottom: 536,
    })
  })
})
