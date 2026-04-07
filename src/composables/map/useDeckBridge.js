import { ref, nextTick } from 'vue'
import { toLonLat } from 'ol/proj'
import { unByKey } from 'ol/Observable'

function computeHeatmapRadius(zoomValue) {
  const zoom = Number.isFinite(zoomValue) ? zoomValue : 13
  const minZ = 10
  const maxZ = 16
  const clampedZoom = Math.max(minZ, Math.min(maxZ, zoom))
  const ratio = (clampedZoom - minZ) / (maxZ - minZ)
  return Math.round(90 - ratio * (90 - 40))
}

export function useDeckBridge({
  mapRef,
  mapContainerRef,
  heatmapEnabledRef,
  getCurrentLocatedPoi,
  onAfterSync
}) {
  const highlightData = ref([])
  const heatmapData = ref([])

  let deckInstance = null
  let deckContainer = null

  let DeckClass = null
  let DeckHeatmapLayerClass = null
  let deckRuntimePromise = null

  let deckSyncAnimationId = null
  let deckLayersDirty = false
  let lastDeckHeatmapRadius = null
  let deckViewListenerKeys = []

  function getDeckViewState() {
    const map = mapRef.value
    if (!map) {
      return { longitude: 114.33, latitude: 30.58, zoom: 12, bearing: 0, pitch: 0 }
    }
    const view = map.getView()
    const center = view.getCenter()
    const zoom = view.getZoom()
    const rotation = view.getRotation()

    if (!center || zoom === undefined) {
      return { longitude: 114.33, latitude: 30.58, zoom: 12, bearing: 0, pitch: 0 }
    }

    const [lon, lat] = toLonLat(center)

    return {
      longitude: lon,
      latitude: lat,
      zoom: zoom - 1,
      bearing: (-rotation * 180) / Math.PI,
      pitch: 0
    }
  }

  async function loadDeckRuntime() {
    if (DeckClass && DeckHeatmapLayerClass) {
      return true
    }

    if (!deckRuntimePromise) {
      deckRuntimePromise = Promise.all([
        import('@deck.gl/core'),
        import('@deck.gl/aggregation-layers')
      ]).then(([core, aggregation]) => {
        DeckClass = core?.Deck || null
        DeckHeatmapLayerClass = aggregation?.HeatmapLayer || null
        return Boolean(DeckClass && DeckHeatmapLayerClass)
      }).catch((error) => {
        console.warn('[MapContainer] deck.gl runtime load failed:', error)
        DeckClass = null
        DeckHeatmapLayerClass = null
        return false
      }).finally(() => {
        deckRuntimePromise = null
      })
    }

    return deckRuntimePromise
  }

  function markDeckLayersDirty() {
    deckLayersDirty = true
  }

  function updateDeckLayers() {
    const map = mapRef.value
    if (!deckInstance || !DeckHeatmapLayerClass || !map) return

    const zoom = map.getView().getZoom() || 13
    const heatmapRadius = computeHeatmapRadius(zoom)
    lastDeckHeatmapRadius = heatmapRadius

    const layers = [
      new DeckHeatmapLayerClass({
        id: 'heatmap-layer',
        data: heatmapData.value,
        visible: heatmapEnabledRef.value,
        pickable: false,
        getPosition: (d) => [d.lon, d.lat],
        getWeight: 1,
        radiusPixels: heatmapRadius,
        intensity: 5,
        threshold: 0.01,
        colorRange: [
          [255, 255, 178, 150],
          [254, 217, 118, 180],
          [254, 178, 76, 200],
          [253, 141, 60, 220],
          [240, 59, 32, 240],
          [189, 0, 38, 255]
        ],
        updateTriggers: {
          getPosition: [heatmapData.value],
          radiusPixels: [zoom]
        }
      })
    ]

    deckInstance.setProps({ layers })
  }

  function syncDeckView() {
    if (!deckInstance) return
    deckInstance.setProps({ viewState: getDeckViewState() })
  }

  function scheduleDeckSync({ forceLayerRefresh = false } = {}) {
    if (forceLayerRefresh) {
      markDeckLayersDirty()
    }
    if (deckSyncAnimationId !== null) return

    deckSyncAnimationId = requestAnimationFrame(() => {
      deckSyncAnimationId = null
      syncDeckView()
      const map = mapRef.value
      if (map) {
        const zoom = map.getView().getZoom()
        const radius = computeHeatmapRadius(zoom)
        if (radius !== lastDeckHeatmapRadius) {
          markDeckLayersDirty()
        }
      }
      if (deckLayersDirty) {
        updateDeckLayers()
        deckLayersDirty = false
      }
      if (typeof onAfterSync === 'function') {
        onAfterSync()
      }
    })
  }

  async function ensureDeckInitialized() {
    const map = mapRef.value
    const mapContainer = mapContainerRef.value
    if (deckInstance || !map || !mapContainer) return deckInstance

    const runtimeReady = await loadDeckRuntime()
    if (!runtimeReady || !DeckClass) return null

    deckContainer = document.createElement('div')
    deckContainer.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      z-index: 1;
    `
    mapContainer.appendChild(deckContainer)

    deckInstance = new DeckClass({
      parent: deckContainer,
      style: { position: 'absolute', top: 0, left: 0, pointerEvents: 'none' },
      initialViewState: getDeckViewState(),
      controller: false,
      layers: [],
      getTooltip: null,
      pickingRadius: 8
    })

    const view = map.getView()
    deckViewListenerKeys = [
      view.on('change:resolution', scheduleDeckSync),
      view.on('change:center', scheduleDeckSync),
      view.on('change:rotation', scheduleDeckSync)
    ]

    nextTick(() => {
      const canvas = deckContainer?.querySelector?.('canvas')
      if (canvas) canvas.style.pointerEvents = 'none'
    })

    markDeckLayersDirty()
    scheduleDeckSync({ forceLayerRefresh: true })
    return deckInstance
  }

  function pickDeckObject(pixel, radius = 10) {
    if (!deckInstance) return null
    if (!pixel || !Number.isFinite(pixel[0]) || !Number.isFinite(pixel[1])) return null
    try {
      const pickInfo = deckInstance.pickObject({
        x: pixel[0],
        y: pixel[1],
        radius
      })
      return pickInfo?.object || null
    } catch {
      return null
    }
  }

  function clearDeckData() {
    highlightData.value = []
    heatmapData.value = []
    if (deckInstance) {
      markDeckLayersDirty()
      scheduleDeckSync({ forceLayerRefresh: true })
    }
  }

  function destroyDeckBridge() {
    if (deckSyncAnimationId !== null) {
      cancelAnimationFrame(deckSyncAnimationId)
      deckSyncAnimationId = null
    }

    if (deckViewListenerKeys.length > 0) {
      unByKey(deckViewListenerKeys)
      deckViewListenerKeys = []
    }

    if (deckInstance) {
      try {
        deckInstance.finalize()
      } catch {
        // ignore
      }
      deckInstance = null
    }

    if (deckContainer && deckContainer.parentNode) {
      deckContainer.parentNode.removeChild(deckContainer)
    }
    deckContainer = null
  }

  return {
    highlightData,
    heatmapData,
    ensureDeckInitialized,
    markDeckLayersDirty,
    scheduleDeckSync,
    pickDeckObject,
    clearDeckData,
    destroyDeckBridge
  }
}
