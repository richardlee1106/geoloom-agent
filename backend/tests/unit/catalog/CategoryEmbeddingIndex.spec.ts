import { describe, expect, it } from 'vitest'

import type { EmbedRerankBridge } from '../../../src/integration/jinaBridge.js'
import { CategoryEmbeddingIndex } from '../../../src/catalog/categoryEmbeddingIndex.js'

function createBridge(vectorsByText: Record<string, number[]>): EmbedRerankBridge {
  return {
    async embed(texts: string[]) {
      return {
        embeddings: texts.map((text) => vectorsByText[text] || [0, 0]),
        dim: 2,
        count: texts.length,
      }
    },
    async rerank(_pairs: Array<{ query: string; document: string }>) {
      return { scores: [] }
    },
    async getStatus() {
      return {
        name: 'jina_api',
        ready: true,
        degraded: false,
        mode: 'remote',
      }
    },
  }
}

describe('CategoryEmbeddingIndex', () => {
  it('falls back to categoryMain for generic dining queries', async () => {
    const index = new CategoryEmbeddingIndex()
    ;(index as any).ready = true
    ;(index as any).entries = [
      { main: '餐饮美食', sub: '茶座', label: '餐饮美食 茶座', embedding: [1, 0] },
      { main: '餐饮美食', sub: '咖啡', label: '餐饮美食 咖啡', embedding: [0.8, 0.2] },
      { main: '购物服务', sub: '商场', label: '购物服务 商场', embedding: [0, 1] },
    ]

    const result = await index.resolve('好吃的餐厅推荐', createBridge({
      '餐厅': [1, 0],
    }))

    expect(result).toMatchObject({
      categoryMain: '餐饮美食',
      categorySub: '餐饮美食',
      matched: true,
    })
  })

  it('keeps categorySub when the query explicitly names a subtype', async () => {
    const index = new CategoryEmbeddingIndex()
    ;(index as any).ready = true
    ;(index as any).entries = [
      { main: '餐饮美食', sub: '茶座', label: '餐饮美食 茶座', embedding: [0.4, 0.6] },
      { main: '餐饮美食', sub: '咖啡', label: '餐饮美食 咖啡', embedding: [1, 0] },
      { main: '购物服务', sub: '商场', label: '购物服务 商场', embedding: [0, 1] },
    ]

    const result = await index.resolve('附近有咖啡店吗', createBridge({
      '有咖啡店吗': [1, 0],
    }))

    expect(result).toMatchObject({
      categoryMain: '餐饮美食',
      categorySub: '咖啡',
      matched: true,
    })
  })
})
