import { nextTick, ref, type Ref } from 'vue'
import { unByKey } from 'ol/Observable'

type CoordinatePair = [number, number]
type PopupPlacement = 'top' | 'bottom'
type PopupStyle = {
  left: string
  top: string
  '--popup-arrow-left'?: string
}

interface PopupElementLike {
  offsetWidth?: number
  offsetHeight?: number
}

interface MapContainerLike {
  clientWidth?: number
  clientHeight?: number
}

interface ViewLike {
  on?: (eventName: string, callback: () => void) => unknown
}

interface MapLike {
  getPixelFromCoordinate?: (coordinate: CoordinatePair) => unknown
}

interface UsePopupAnchorArgs {
  mapRef: Ref<MapLike | null>
  mapContainerRef: Ref<MapContainerLike | null>
  popupRef: Ref<PopupElementLike | null>
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min
  if (value > max) return max
  return value
}

export function usePopupAnchor({
  mapRef,
  mapContainerRef,
  popupRef
}: UsePopupAnchorArgs) {
  const popupVisible = ref(false)
  const popupName = ref('')
  const popupDetailLines = ref<string[]>([])
  const popupStyle = ref<PopupStyle>({ left: '0px', top: '0px' })
  const popupPlacement = ref<PopupPlacement>('top')
  const popupAnchorCoordinate = ref<CoordinatePair | null>(null)

  let popupPositionAnimationId: number | null = null
  let popupViewListenerKeys: Array<Parameters<typeof unByKey>[0]> = []
  let popupHideTimer: ReturnType<typeof setTimeout> | null = null

  function clearPopupHideTimer(): void {
    if (popupHideTimer) {
      clearTimeout(popupHideTimer)
      popupHideTimer = null
    }
  }

  function positionPopup(): void {
    const popupElement = popupRef.value
    const mapContainer = mapContainerRef.value
    const map = mapRef.value
    if (!popupElement || !mapContainer || !map) return
    if (!Array.isArray(popupAnchorCoordinate.value) || popupAnchorCoordinate.value.length < 2) return

    const pixel = map.getPixelFromCoordinate?.(popupAnchorCoordinate.value)
    if (!Array.isArray(pixel) || pixel.length < 2) return

    const mapWidth = mapContainer.clientWidth || 0
    const mapHeight = mapContainer.clientHeight || 0
    if (mapWidth <= 0 || mapHeight <= 0) return

    const popupWidth = popupElement.offsetWidth || 260
    const popupHeight = popupElement.offsetHeight || 80
    const margin = 10
    const anchorGap = 12

    const anchorX = Number(pixel[0])
    const anchorY = Number(pixel[1])
    if (!Number.isFinite(anchorX) || !Number.isFinite(anchorY)) return

    let placement: PopupPlacement = 'top'
    let top = anchorY - popupHeight - anchorGap
    if (top < margin) {
      placement = 'bottom'
      top = anchorY + anchorGap
    }
    if (top + popupHeight > mapHeight - margin) {
      top = Math.max(margin, mapHeight - margin - popupHeight)
    }

    const left = clamp(
      anchorX - popupWidth / 2,
      margin,
      Math.max(margin, mapWidth - margin - popupWidth)
    )

    popupPlacement.value = placement
    popupStyle.value = {
      left: `${Math.round(left)}px`,
      top: `${Math.round(top)}px`,
      '--popup-arrow-left': `${Math.round(clamp(anchorX - left, 14, popupWidth - 14))}px`
    }
  }

  function schedulePopupPosition(): void {
    if (!popupVisible.value) return
    if (popupPositionAnimationId !== null) return
    popupPositionAnimationId = requestAnimationFrame(() => {
      popupPositionAnimationId = null
      positionPopup()
    })
  }

  function hidePopup(): void {
    clearPopupHideTimer()
    popupVisible.value = false
    popupDetailLines.value = []
    popupAnchorCoordinate.value = null
  }

  function showTextPopup(label: unknown, anchor: unknown, autoHideMs = 2800, detailLines: unknown = []): void {
    popupName.value = String(label || '').trim() || '未命名片区'
    popupDetailLines.value = Array.isArray(detailLines)
      ? detailLines.map((line) => String(line || '').trim()).filter(Boolean).slice(0, 4)
      : []
    popupAnchorCoordinate.value = Array.isArray(anchor) && anchor.length >= 2
      ? [Number(anchor[0]), Number(anchor[1])]
      : null
    popupPlacement.value = 'top'
    popupVisible.value = true

    nextTick(() => {
      positionPopup()
    })

    clearPopupHideTimer()
    popupHideTimer = setTimeout(() => {
      hidePopup()
    }, autoHideMs)
  }

  function showPoiPopup(feature: Record<string, unknown> | null | undefined, anchor: unknown): void {
    const props = feature?.properties && typeof feature.properties === 'object' && !Array.isArray(feature.properties)
      ? feature.properties as Record<string, unknown>
      : feature || {}
    const name = props['名称'] || props.name || props.poi_name || props.poiName || props.title || props.label || '未命名POI'
    const category = props.category_small || props.category_mid || props.category_big || props.type || ''
    const address = props.address || props.addr || ''
    const detailLines = [category, address].map((value) => String(value || '').trim()).filter(Boolean).slice(0, 2)
    showTextPopup(name, anchor, 3200, detailLines)
  }

  function showBoundaryPopup(label: unknown, anchor: unknown, detailLines: unknown = []): void {
    const normalizedLines = Array.isArray(detailLines) ? detailLines : []
    showTextPopup(label, anchor, 2800, normalizedLines)
  }

  function attachPopupViewListeners(view: ViewLike | null | undefined): void {
    if (popupViewListenerKeys.length > 0) {
      popupViewListenerKeys.forEach((key) => {
        unByKey(key)
      })
      popupViewListenerKeys = []
    }
    if (!view) return
    popupViewListenerKeys = [
      view.on?.('change:center', schedulePopupPosition),
      view.on?.('change:resolution', schedulePopupPosition),
      view.on?.('change:rotation', schedulePopupPosition)
    ].filter((key): key is Parameters<typeof unByKey>[0] => Boolean(key))
  }

  function cleanupPopupAnchor(): void {
    clearPopupHideTimer()
    if (popupPositionAnimationId !== null) {
      cancelAnimationFrame(popupPositionAnimationId)
      popupPositionAnimationId = null
    }
    if (popupViewListenerKeys.length > 0) {
      popupViewListenerKeys.forEach((key) => {
        unByKey(key)
      })
      popupViewListenerKeys = []
    }
    popupVisible.value = false
    popupDetailLines.value = []
    popupAnchorCoordinate.value = null
  }

  return {
    popupVisible,
    popupName,
    popupDetailLines,
    popupStyle,
    popupPlacement,
    popupAnchorCoordinate,
    schedulePopupPosition,
    positionPopup,
    showTextPopup,
    showPoiPopup,
    showBoundaryPopup,
    hidePopup,
    attachPopupViewListeners,
    cleanupPopupAnchor
  }
}
