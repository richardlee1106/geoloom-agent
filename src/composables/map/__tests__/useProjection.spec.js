import { describe, expect, it } from 'vitest'

import { useProjection } from '../useProjection'

describe('useProjection', () => {
  it('treats coordSys values with surrounding whitespace as wgs84', () => {
    const { toGcj02IfNeeded, wgs84ToGcj02 } = useProjection()

    expect(toGcj02IfNeeded(114.3349, 30.5848, ' wGs84 ')).toEqual(
      wgs84ToGcj02(114.3349, 30.5848)
    )
  })

  // gcj02ToWgs84 必须是 wgs84ToGcj02 的近似反函数，否则 NarrativeMode 把
  // 高德 GCJ02 底图经纬度发给后端时会产生约 500m 的视口偏移。
  it('gcj02ToWgs84 round-trips wgs84ToGcj02 within 1e-5 degrees', () => {
    const { wgs84ToGcj02, gcj02ToWgs84 } = useProjection()
    const [gcjLon, gcjLat] = wgs84ToGcj02(114.3349, 30.5848)
    const [wgsLon, wgsLat] = gcj02ToWgs84(gcjLon, gcjLat)
    expect(Math.abs(wgsLon - 114.3349)).toBeLessThan(1e-5)
    expect(Math.abs(wgsLat - 30.5848)).toBeLessThan(1e-5)
  })

  it('gcj02ToWgs84 is a no-op outside China', () => {
    const { gcj02ToWgs84 } = useProjection()
    const [lon, lat] = gcj02ToWgs84(-73.985, 40.758)
    expect(lon).toBe(-73.985)
    expect(lat).toBe(40.758)
  })
})
