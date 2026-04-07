import { describe, expect, it } from 'vitest'

import { useProjection } from '../useProjection'

describe('useProjection', () => {
  it('treats coordSys values with surrounding whitespace as wgs84', () => {
    const { toGcj02IfNeeded, wgs84ToGcj02 } = useProjection()

    expect(toGcj02IfNeeded(114.3349, 30.5848, ' wGs84 ')).toEqual(
      wgs84ToGcj02(114.3349, 30.5848)
    )
  })
})
