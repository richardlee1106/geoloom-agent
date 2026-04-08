import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const originalSelf = globalThis.self
const originalOffscreenCanvas = globalThis.OffscreenCanvas

class FakeCanvasContext {
  constructor() {
    this.font = '16px sans-serif'
  }

  measureText(text) {
    return { width: String(text).length * 8 }
  }
}

class FakeOffscreenCanvas {
  constructor(width, height) {
    this.width = width
    this.height = height
  }

  getContext() {
    return new FakeCanvasContext()
  }
}

async function loadWorkerModule() {
  vi.resetModules()
  await import('../geo.worker')
  return globalThis.self
}

function getDistanceFromCenter(layout, tagName) {
  const center = layout.find((tag) => tag.isCenter)
  const target = layout.find((tag) => tag.name === tagName)

  return Math.hypot(target.x - center.x, target.y - center.y)
}

beforeEach(() => {
  globalThis.OffscreenCanvas = FakeOffscreenCanvas
  globalThis.self = {
    onmessage: null,
    postMessage: vi.fn()
  }

  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  globalThis.self = originalSelf
  globalThis.OffscreenCanvas = originalOffscreenCanvas
  vi.restoreAllMocks()
})

describe('geo worker', () => {
  it('respects minTagSpacing when searching for a valid position', async () => {
    const workerScope = await loadWorkerModule()
    const payload = {
      tags: [
        { name: 'Same', lon: 0, lat: 0 }
      ],
      width: 320,
      height: 240,
      center: [0, 0],
      config: {
        fontMin: 14,
        fontMax: 14
      }
    }

    await workerScope.onmessage({
      data: {
        ...payload,
        config: {
          ...payload.config,
          minTagSpacing: 2
        }
      }
    })

    const tightLayout = workerScope.postMessage.mock.calls.at(-1)?.[0] || []
    const tightDistance = getDistanceFromCenter(tightLayout, 'Same')

    workerScope.postMessage.mockClear()

    await workerScope.onmessage({
      data: {
        ...payload,
        config: {
          ...payload.config,
          minTagSpacing: 30
        }
      }
    })

    const looseLayout = workerScope.postMessage.mock.calls.at(-1)?.[0] || []
    const looseDistance = getDistanceFromCenter(looseLayout, 'Same')

    expect(looseDistance).toBeGreaterThan(tightDistance + 5)
  })
})
