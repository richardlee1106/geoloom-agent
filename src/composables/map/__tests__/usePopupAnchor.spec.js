import { nextTick, ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { usePopupAnchor } from '../usePopupAnchor'

afterEach(() => {
  vi.useRealTimers()
})

describe('usePopupAnchor', () => {
  it('clears popup content and anchor state during cleanup', async () => {
    vi.useFakeTimers()

    const popupApi = usePopupAnchor({
      mapRef: ref({
        getPixelFromCoordinate() {
          return [120, 80]
        }
      }),
      mapContainerRef: ref({
        clientWidth: 400,
        clientHeight: 300
      }),
      popupRef: ref({
        offsetWidth: 180,
        offsetHeight: 60
      })
    })

    popupApi.showTextPopup('热点A', [114.33, 30.58], 5000, ['商业', '地铁口'])
    await nextTick()

    expect(popupApi.popupVisible.value).toBe(true)
    expect(popupApi.popupDetailLines.value).toEqual(['商业', '地铁口'])
    expect(popupApi.popupAnchorCoordinate.value).toEqual([114.33, 30.58])

    popupApi.cleanupPopupAnchor()

    expect(popupApi.popupVisible.value).toBe(false)
    expect(popupApi.popupDetailLines.value).toEqual([])
    expect(popupApi.popupAnchorCoordinate.value).toBeNull()
  })
})
