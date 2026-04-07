import { nextTick, ref, type Ref } from 'vue'
import { toLonLat } from 'ol/proj'
import { unByKey } from 'ol/Observable'

type CoordinatePair = [number, number]
type DeckViewState = {
  longitude: number
  latitude: number
  zoom: number
  bearing: number
  pitch: number
}

type HeatmapDatum = {
  lon: number
  lat: number
  [key: string]: unknown
}

type DeckLayerUpdate = {
  layers?: unknown[]
  viewState?: DeckViewState
}

type DeckPickParams = {
  x: number
  y: number
  radius: number
}

type DeckPickInfo = {
  object?: unknown
}

type DeckRuntimeInstance = {
  setProps: (props: DeckLayerUpdate) => void
  pickObject: (params: DeckPickParams) => DeckPickInfo | null | undefined
  finalize: () => void
}

type DeckRuntimeConstructor = new (props: {
  parent: HTMLDivElement
  style: Record<string, string>
  initialViewState: DeckViewState
  controller: boolean
  layers: unknown[]
  getTooltip: null
  pickingRadius: number
}) => DeckRuntimeInstance

type HeatmapLayerConstructor = new (props: {
  id: string
  data: HeatmapDatum[]
  visible: boolean
  pickable: boolean
  getPosition: (datum: HeatmapDatum) => CoordinatePair
  getWeight: number
  radiusPixels: number
  intensity: number
  threshold: number
  colorRange: number[][]
  updateTriggers: {
    getPosition: [HeatmapDatum[]]
    radiusPixels: [number]
  }
}) => unknown

type DeckSyncOptions = {
  forceLayerRefresh?: boolean
}

interface ViewLike {
  getCenter?: () => unknown
  getZoom?: () => number | undefined
  getRotation?: () => number | undefined
  on?: (
    eventName: 'change:resolution' | 'change:center' | 'change:rotation',
    callback: () => void
  ) => Parameters<typeof unByKey>[0] | null | undefined
}

interface MapLike {
  getView?: () => ViewLike | null | undefined
}

interface UseDeckBridgeArgs {
  mapRef: Ref<MapLike | null>
  mapContainerRef: Ref<HTMLElement | null>
  heatmapEnabledRef: Ref<boolean>
  getCurrentLocatedPoi?: (() => unknown) | null
  onAfterSync?: (() => void) | null
}

function computeHeatmapRadius(zoomValue: number | undefined): number {
  const zoom = typeof zoomValue === 'number' && Number.isFinite(zoomValue) ? zoomValue : 13
  const minZ = 10
  const maxZ = 16
  const clampedZoom = Math.max(minZ, Math.min(maxZ, zoom))
  const ratio = (clampedZoom - minZ) / (maxZ - minZ)
  return Math.round(90 - ratio * (90 - 40))
}

function normalizeCoordinatePair(value: unknown): CoordinatePair | null {
  if (!Array.isArray(value) || value.length < 2) {
    return null
  }

  const x = Number(value[0])
  const y = Number(value[1])
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null
  }

  return [x, y]
}

export function useDeckBridge({
  mapRef,
  mapContainerRef,
  heatmapEnabledRef,
  getCurrentLocatedPoi: _getCurrentLocatedPoi,
  onAfterSync
}: UseDeckBridgeArgs) {
  const highlightData = ref<unknown[]>([])
  const heatmapData = ref<HeatmapDatum[]>([])

  let deckInstance: DeckRuntimeInstance | null = null
  let deckContainer: HTMLDivElement | null = null

  let DeckClass: DeckRuntimeConstructor | null = null
  let DeckHeatmapLayerClass: HeatmapLayerConstructor | null = null
  let deckRuntimePromise: Promise<boolean> | null = null
  let deckInitializationPromise: Promise<DeckRuntimeInstance | null> | null = null

  let deckSyncAnimationId: number | null = null
  let deckLayersDirty = false
  let lastDeckHeatmapRadius: number | null = null
  let deckViewListenerKeys: Array<Parameters<typeof unByKey>[0]> = []

  function getDefaultViewState(): DeckViewState {
    return { longitude: 114.33, latitude: 30.58, zoom: 12, bearing: 0, pitch: 0 }
  }

  function getDeckViewState(): DeckViewState {
    const map = mapRef.value
    const view = map?.getView?.()
    if (!view) {
      return getDefaultViewState()
    }

    const center = normalizeCoordinatePair(view.getCenter?.())
    const zoom = view.getZoom?.()
    const rotation = view.getRotation?.() || 0

    if (!center || zoom === undefined) {
      return getDefaultViewState()
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

  async function loadDeckRuntime(): Promise<boolean> {
    if (DeckClass && DeckHeatmapLayerClass) {
      return true
    }

    if (!deckRuntimePromise) {
      deckRuntimePromise = Promise.all([
        import('@deck.gl/core'),
        import('@deck.gl/aggregation-layers')
      ])
        .then(([core, aggregation]) => {
          DeckClass = (core?.Deck || null) as DeckRuntimeConstructor | null
          DeckHeatmapLayerClass = (aggregation?.HeatmapLayer || null) as HeatmapLayerConstructor | null
          return Boolean(DeckClass && DeckHeatmapLayerClass)
        })
        .catch((error: unknown) => {
          console.warn('[MapContainer] deck.gl runtime load failed:', error)
          DeckClass = null
          DeckHeatmapLayerClass = null
          return false
        })
        .finally(() => {
          deckRuntimePromise = null
        })
    }

    return deckRuntimePromise
  }

  function markDeckLayersDirty(): void {
    deckLayersDirty = true
  }

  function updateDeckLayers(): void {
    const map = mapRef.value
    const view = map?.getView?.()
    if (!deckInstance || !DeckHeatmapLayerClass || !view) return

    const zoom = view.getZoom?.() || 13
    const heatmapRadius = computeHeatmapRadius(zoom)
    lastDeckHeatmapRadius = heatmapRadius

    const layers = [
      new DeckHeatmapLayerClass({
        id: 'heatmap-layer',
        data: heatmapData.value,
        visible: heatmapEnabledRef.value,
        pickable: false,
        getPosition: (datum) => [datum.lon, datum.lat],
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

  function syncDeckView(): void {
    if (!deckInstance) return
    deckInstance.setProps({ viewState: getDeckViewState() })
  }

  function scheduleDeckSync({ forceLayerRefresh = false }: DeckSyncOptions = {}): void {
    if (forceLayerRefresh) {
      markDeckLayersDirty()
    }
    if (deckSyncAnimationId !== null) return

    deckSyncAnimationId = requestAnimationFrame(() => {
      deckSyncAnimationId = null
      syncDeckView()
      const view = mapRef.value?.getView?.()
      if (view) {
        const zoom = view.getZoom?.()
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

  async function ensureDeckInitialized(): Promise<DeckRuntimeInstance | null> {
    if (deckInstance) return deckInstance

    const currentMap = mapRef.value
    const currentMapContainer = mapContainerRef.value
    if (!currentMap || !currentMapContainer) return null

    if (deckInitializationPromise) {
      return deckInitializationPromise
    }

    deckInitializationPromise = (async () => {
      const runtimeReady = await loadDeckRuntime()
      if (!runtimeReady || !DeckClass) return null
      if (deckInstance) return deckInstance

      const map = mapRef.value
      const mapContainer = mapContainerRef.value
      if (!map || !mapContainer) return null

      const createdDeckContainer = document.createElement('div')
      createdDeckContainer.style.cssText = `
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        pointer-events: none;
        z-index: 1;
      `
      mapContainer.appendChild(createdDeckContainer)

      deckContainer = createdDeckContainer
      deckInstance = new DeckClass({
        parent: createdDeckContainer,
        style: { position: 'absolute', top: '0', left: '0', pointerEvents: 'none' },
        initialViewState: getDeckViewState(),
        controller: false,
        layers: [],
        getTooltip: null,
        pickingRadius: 8
      })

      const view = map.getView?.()
      if (view?.on) {
        deckViewListenerKeys = [
          view.on('change:resolution', scheduleDeckSync),
          view.on('change:center', scheduleDeckSync),
          view.on('change:rotation', scheduleDeckSync)
        ].filter((key): key is Parameters<typeof unByKey>[0] => Boolean(key))
      }

      nextTick(() => {
        const canvas = deckContainer?.querySelector('canvas')
        if (canvas instanceof HTMLElement) {
          canvas.style.pointerEvents = 'none'
        }
      })

      markDeckLayersDirty()
      scheduleDeckSync({ forceLayerRefresh: true })
      return deckInstance
    })().finally(() => {
      deckInitializationPromise = null
    })

    return deckInitializationPromise
  }

  function pickDeckObject(pixel: unknown, radius = 10): unknown | null {
    if (!deckInstance) return null

    const normalizedPixel = normalizeCoordinatePair(pixel)
    if (!normalizedPixel) return null

    try {
      const pickInfo = deckInstance.pickObject({
        x: normalizedPixel[0],
        y: normalizedPixel[1],
        radius
      })
      return pickInfo?.object || null
    } catch {
      return null
    }
  }

  function clearDeckData(): void {
    highlightData.value = []
    heatmapData.value = []
    if (deckInstance) {
      markDeckLayersDirty()
      scheduleDeckSync({ forceLayerRefresh: true })
    }
  }

  function destroyDeckBridge(): void {
    if (deckSyncAnimationId !== null) {
      cancelAnimationFrame(deckSyncAnimationId)
      deckSyncAnimationId = null
    }

    if (deckViewListenerKeys.length > 0) {
      deckViewListenerKeys.forEach((key) => {
        unByKey(key)
      })
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

    if (deckContainer?.parentNode) {
      deckContainer.parentNode.removeChild(deckContainer)
    }
    deckContainer = null
    deckLayersDirty = false
    lastDeckHeatmapRadius = null
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
