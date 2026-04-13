import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'

import { SSEWriter } from '../../../src/chat/SSEWriter.js'
import type { ToolExecutionTrace } from '../../../src/chat/types.js'
import { DeterministicEvidenceRuntime } from '../../../src/evidence/DeterministicEvidenceRuntime.js'

function createWriter() {
  return new SSEWriter({
    stream: new PassThrough(),
    traceId: 'trace_test_runtime',
    schemaVersion: 'test',
  })
}

describe('DeterministicEvidenceRuntime', () => {
  it('rewrites current-area web queries around preferred anchors for large viewports', async () => {
    const runtime = new DeterministicEvidenceRuntime()
    const calls: Array<{ name: string, arguments: Record<string, unknown> }> = []

    await runtime.execute({
      specs: [
        {
          atom: 'area.representative_samples',
          skill: 'postgis',
          action: 'execute_spatial_sql',
          payloadTemplate: { template: 'area_representative_sample', limit: 18 },
          dependsOn: [],
          parallelizable: true,
        },
        {
          atom: 'area.aoi_context',
          skill: 'postgis',
          action: 'execute_spatial_sql',
          payloadTemplate: { template: 'area_aoi_context', limit: 5 },
          dependsOn: [],
          parallelizable: true,
        },
        {
          atom: 'web.multi_search',
          skill: 'multi_search_engine',
          action: 'search_multi',
          payloadTemplate: {},
          dependsOn: ['area.representative_samples', 'area.aoi_context'],
          parallelizable: true,
        },
      ],
      intent: {
        queryType: 'area_overview',
        intentMode: 'deterministic_visible_loop',
        rawQuery: '当前区域适合开什么店',
        placeName: '当前区域',
        anchorSource: 'map_view',
        targetCategory: '区域洞察',
        radiusM: 1200,
        needsClarification: false,
        clarificationHint: null,
        viewportContext: {
          diagonalM: 8400,
          scale: 'large',
        },
      },
      state: {
        requestId: 'req_runtime_001',
        traceId: 'trace_runtime_001',
        sessionId: 'sess_runtime_001',
        toolCalls: [],
        anchors: {},
        sqlValidationAttempts: 0,
        sqlValidationPassed: 0,
      },
      writer: createWriter(),
      executeToolCall: async (call) => {
        calls.push(call)
        const action = String(call.arguments.action || '')
        const payload = (call.arguments.payload || {}) as Record<string, unknown>
        let result: Record<string, unknown> = { rows: [] }

        if (call.name === 'postgis' && action === 'execute_spatial_sql' && payload.template === 'area_representative_sample') {
          result = {
            rows: [
              { id: 1, name: '武大地铁站', category_main: '交通设施服务', category_sub: '地铁站', distance_m: 120 },
              { id: 2, name: '老王烧烤', category_main: '餐饮美食', category_sub: '烧烤店', distance_m: 80 },
            ],
          }
        } else if (call.name === 'postgis' && action === 'execute_spatial_sql' && payload.template === 'area_aoi_context') {
          result = {
            rows: [
              { id: 11, name: '武汉大学', fclass: 'school', area_sqm: 180000 },
              { id: 12, name: '街道口商圈', fclass: 'commercial', area_sqm: 150000 },
            ],
          }
        } else if (call.name === 'multi_search_engine') {
          result = { merged: [] }
        }

        const trace: ToolExecutionTrace = {
          id: String(call.id || `${call.name}_${action}`),
          skill: call.name,
          action,
          status: 'done',
          payload: payload,
          result: {
            ok: true,
            data: result,
            meta: { action },
          },
        }

        return {
          content: result,
          trace,
        }
      },
    })

    const searchCall = calls.find((call) => call.name === 'multi_search_engine')
    expect(searchCall).toBeTruthy()
    expect((searchCall?.arguments.payload as Record<string, unknown>).query).toBe('武汉大学 当前区域适合开什么店')
  })

  it('fans out candidate reputation searches from nearby POIs instead of raw NL queries', async () => {
    const runtime = new DeterministicEvidenceRuntime()
    const calls: Array<{ name: string, arguments: Record<string, unknown> }> = []

    await runtime.execute({
      specs: [
        {
          atom: 'poi.nearby_list',
          skill: 'postgis',
          action: 'execute_spatial_sql',
          payloadTemplate: { template: 'nearby_poi', limit: 10 },
          dependsOn: [],
          parallelizable: true,
        },
        {
          atom: 'web.multi_search',
          skill: 'multi_search_engine',
          action: 'search_multi',
          payloadTemplate: {},
          dependsOn: ['poi.nearby_list'],
          parallelizable: true,
        },
      ],
      intent: {
        queryType: 'nearby_poi',
        intentMode: 'deterministic_visible_loop',
        rawQuery: '这块有哪些高分推荐的酒店？',
        placeName: '当前区域',
        anchorSource: 'map_view',
        targetCategory: '酒店',
        radiusM: 800,
        needsClarification: false,
        clarificationHint: null,
        needsWebSearch: true,
        toolIntent: 'candidate_reputation',
        searchIntentHint: '酒店 评分 推荐',
      },
      state: {
        requestId: 'req_runtime_002',
        traceId: 'trace_runtime_002',
        sessionId: 'sess_runtime_002',
        toolCalls: [],
        anchors: {},
        sqlValidationAttempts: 0,
        sqlValidationPassed: 0,
      },
      writer: createWriter(),
      executeToolCall: async (call) => {
        calls.push(call)
        const action = String(call.arguments.action || '')
        const payload = (call.arguments.payload || {}) as Record<string, unknown>
        let result: Record<string, unknown> = { rows: [] }

        if (call.name === 'postgis' && action === 'execute_spatial_sql') {
          result = {
            rows: [
              { id: 1, name: '英若宾馆', category_main: '住宿服务', category_sub: '宾馆酒店', distance_m: 34 },
              { id: 2, name: '武汉戴丁客栈', category_main: '住宿服务', category_sub: '宾馆酒店', distance_m: 35 },
              { id: 3, name: '凯莱熙酒店', category_main: '住宿服务', category_sub: '宾馆酒店', distance_m: 89 },
            ],
          }
        } else if (call.name === 'multi_search_engine') {
          result = { merged: [] }
        }

        const trace: ToolExecutionTrace = {
          id: String(call.id || `${call.name}_${action}`),
          skill: call.name,
          action,
          status: 'done',
          payload,
          result: {
            ok: true,
            data: result,
            meta: { action },
          },
        }

        return {
          content: result,
          trace,
        }
      },
    })

    const searchCall = calls.find((call) => call.name === 'multi_search_engine')
    expect(searchCall).toBeTruthy()
    expect((searchCall?.arguments.payload as Record<string, unknown>).query).toBe('英若宾馆 酒店 评分 推荐')
    expect((searchCall?.arguments.payload as Record<string, unknown>).queries).toEqual([
      '英若宾馆 酒店 评分 推荐',
      '武汉戴丁客栈 酒店 评分 推荐',
      '凯莱熙酒店 酒店 评分 推荐',
    ])
  })
})
