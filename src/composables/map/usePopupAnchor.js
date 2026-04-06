import { ref, nextTick } from 'vue'
import { unByKey } from 'ol/Observable'

function clamp(value, min, max) {
  if (value < min) return min
  if (value > max) return max
  return value
}

export function usePopupAnchor({
  mapRef,
  mapContainerRef,
  popupRef
}) {
  const popupVisible = ref(false)
  const popupName = ref('')
  const popupDetailLines = ref([])
  const popupStyle = ref({ left: '0px', top: '0px' })
  const popupPlacement = ref('top')
  const popupAnchorCoordinate = ref(null)

  let popupPositionAnimationId = null
  let popupViewListenerKeys = []
  let popupHideTimer = null

  function clearPopupHideTimer() {
    if (popupHideTimer) {
      clearTimeout(popupHideTimer)
      popupHideTimer = null
    }
  }

  function positionPopup() {
    const popupElement = popupRef.value
    const mapContainer = mapContainerRef.value
    const map = mapRef.value
    if (!popupElement || !mapContainer || !map) return
    if (!Array.isArray(popupAnchorCoordinate.value) || popupAnchorCoordinate.value.length < 2) return

    const pixel = map.getPixelFromCoordinate(popupAnchorCoordinate.value)
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

    let placement = 'top'
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

  function schedulePopupPosition() {
    if (!popupVisible.value) return
    if (popupPositionAnimationId !== null) return
    popupPositionAnimationId = requestAnimationFrame(() => {
      popupPositionAnimationId = null
      positionPopup()
    })
  }

  function hidePopup() {
    clearPopupHideTimer()
    popupVisible.value = false
    popupDetailLines.value = []
    popupAnchorCoordinate.value = null
  }

  function showTextPopup(label, anchor, autoHideMs = 2800, detailLines = []) {
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

  function showPoiPopup(feature, anchor) {
    const props = feature.properties || feature
    const name = props['名称'] || props.name || props.poi_name || props.poiName || props.title || props.label || '未命名POI'
    const category = props.category_small || props.category_mid || props.category_big || props.type || ''
    const address = props.address || props.addr || ''
    const detailLines = [category, address].map((value) => String(value || '').trim()).filter(Boolean).slice(0, 2)
    showTextPopup(name, anchor, 3200, detailLines)
  }

  function showBoundaryPopup(label, anchor, detailLines = []) {
    const normalizedLines = Array.isArray(detailLines) ? detailLines : []
    showTextPopup(label, anchor, 2800, normalizedLines)
  }

  function attachPopupViewListeners(view) {
    if (popupViewListenerKeys.length > 0) {
      unByKey(popupViewListenerKeys)
      popupViewListenerKeys = []
    }
    if (!view) return
    popupViewListenerKeys = [
      view.on('change:center', schedulePopupPosition),
      view.on('change:resolution', schedulePopupPosition),
      view.on('change:rotation', schedulePopupPosition)
    ]
  }

  function cleanupPopupAnchor() {
    clearPopupHideTimer()
    if (popupPositionAnimationId !== null) {
      cancelAnimationFrame(popupPositionAnimationId)
      popupPositionAnimationId = null
    }
    if (popupViewListenerKeys.length > 0) {
      unByKey(popupViewListenerKeys)
      popupViewListenerKeys = []
    }
    popupVisible.value = false
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
