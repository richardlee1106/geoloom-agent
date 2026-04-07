import { ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const deckBridgeMocks = vi.hoisted(() => ({
  deckConstructorSpy: vi.fn(),
  deckSetPropsSpy: vi.fn(),
  deckFinalizeSpy: vi.fn(),
  heatmapLayerSpy: vi.fn(),
  toLonLatSpy: vi.fn((coordinate) => coordinate)
}))

vi.mock('ol/proj', () => ({
  toLonLat: deckBridgeMocks.toLonLatSpy
}))

vi.mock('@deck.gl/core', () => ({
  Deck: class DeckMock {
    constructor(props) {
      deckBridgeMocks.deckConstructorSpy(props)
      this.setProps = vi.fn((nextProps) => {
        deckBridgeMocks.deckSetPropsSpy(nextProps)
      })
      this.pickObject = vi.fn(() => null)
      this.finalize = vi.fn(() => {
        deckBridgeMocks.deckFinalizeSpy()
      })
    }
  }
}))

vi.mock('@deck.gl/aggregation-layers', () => ({
  HeatmapLayer: class HeatmapLayerMock {
    constructor(props) {
      deckBridgeMocks.heatmapLayerSpy(props)
      Object.assign(this, props)
    }
  }
}))

import { useDeckBridge } from '../useDeckBridge'

describe('useDeckBridge', () => {
  beforeEach(() => {
    deckBridgeMocks.deckConstructorSpy.mockClear()
    deckBridgeMocks.deckSetPropsSpy.mockClear()
    deckBridgeMocks.deckFinalizeSpy.mockClear()
    deckBridgeMocks.heatmapLayerSpy.mockClear()
    deckBridgeMocks.toLonLatSpy.mockClear()

    vi.stubGlobal('requestAnimationFrame', (callback) => {
      callback()
      return 1
    })
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reuses the same deck instance for concurrent initialization calls', async () => {
    const listenerKeys = [{ id: 'resolution' }, { id: 'center' }, { id: 'rotation' }]
    const view = {
      getCenter: vi.fn(() => [114.33, 30.58]),
      getZoom: vi.fn(() => 13),
      getRotation: vi.fn(() => 0),
      on: vi.fn((eventName) => listenerKeys.find((key) => key.id === eventName.split(':')[1]) || { id: eventName })
    }
    const mapContainer = document.createElement('div')

    const deckBridge = useDeckBridge({
      mapRef: ref({
        getView: () => view
      }),
      mapContainerRef: ref(mapContainer),
      heatmapEnabledRef: ref(true),
      getCurrentLocatedPoi: vi.fn(() => null),
      onAfterSync: vi.fn()
    })

    const [firstInstance, secondInstance] = await Promise.all([
      deckBridge.ensureDeckInitialized(),
      deckBridge.ensureDeckInitialized()
    ])

    expect(firstInstance).toBe(secondInstance)
    expect(deckBridgeMocks.deckConstructorSpy).toHaveBeenCalledTimes(1)
    expect(mapContainer.children).toHaveLength(1)
    expect(view.on).toHaveBeenCalledTimes(3)
  })
})
