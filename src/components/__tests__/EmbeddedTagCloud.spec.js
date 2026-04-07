import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import EmbeddedTagCloud from '../EmbeddedTagCloud.vue'

const mockPois = [
  {
    id: 'poi-1',
    name: '湖北大学地铁站A口',
    type: 'Feature',
    geometry: {
      type: 'Point',
      coordinates: [114.3371, 30.5842]
    },
    properties: {
      名称: '湖北大学地铁站A口'
    }
  },
  {
    id: 'poi-2',
    name: '三角路地铁站H口',
    type: 'Feature',
    geometry: {
      type: 'Point',
      coordinates: [114.3292, 30.5907]
    },
    properties: {
      名称: '三角路地铁站H口'
    }
  }
]

class WorkerStub {
  constructor() {
    this.onmessage = null
    this.onerror = null
    this.onmessageerror = null
  }

  postMessage() {}

  terminate() {}
}

class ResizeObserverStub {
  observe() {}

  disconnect() {}
}

describe('EmbeddedTagCloud', () => {
  const originalWorker = globalThis.Worker
  const originalResizeObserver = globalThis.ResizeObserver
  const originalRequestAnimationFrame = globalThis.requestAnimationFrame
  const originalCancelAnimationFrame = globalThis.cancelAnimationFrame

  beforeEach(() => {
    globalThis.Worker = WorkerStub
    globalThis.ResizeObserver = ResizeObserverStub
    globalThis.requestAnimationFrame = vi.fn((callback) => {
      callback()
      return 1
    })
    globalThis.cancelAnimationFrame = vi.fn()
  })

  afterEach(() => {
    globalThis.Worker = originalWorker
    globalThis.ResizeObserver = originalResizeObserver
    globalThis.requestAnimationFrame = originalRequestAnimationFrame
    globalThis.cancelAnimationFrame = originalCancelAnimationFrame
  })

  it('renders original pois to map immediately without waiting for layout worker output', async () => {
    const wrapper = mount(EmbeddedTagCloud, {
      props: {
        pois: mockPois,
        width: 360,
        height: 220
      },
      attachTo: document.body
    })

    const renderButton = wrapper.find('.render-btn')
    expect(renderButton.exists()).toBe(true)

    await renderButton.trigger('click')

    const emitted = wrapper.emitted('render-to-map')
    expect(emitted).toBeTruthy()
    expect(emitted[0][0]).toEqual(mockPois)
  })
})
