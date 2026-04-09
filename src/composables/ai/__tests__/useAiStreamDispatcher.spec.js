import { ref } from 'vue'
import { describe, expect, it } from 'vitest'

import { useAiStreamDispatcher } from '../useAiStreamDispatcher'
import { normalizeRefinedResultEvidence } from '../../../utils/refinedResultEvidence'

describe('useAiStreamDispatcher', () => {
  it('records message-level agent events and tool calls for the new process timeline', () => {
    const messagesRef = ref([
      {
        role: 'assistant',
        content: '',
        agentEvents: [],
        toolCalls: [],
      },
    ])
    const extractedPOIsRef = ref([])
    const emitted = []

    const { dispatchMetaEvent } = useAiStreamDispatcher({
      messagesRef,
      extractedPOIsRef,
      emit: (eventName, payload) => emitted.push({ eventName, payload }),
      normalizeRefinedResultEvidence,
      toEmbeddedIntentMode: () => 'macro',
    })

    dispatchMetaEvent({
      type: 'thinking',
      data: { status: 'start', message: '正在思考...' },
      aiMessageIndex: 0,
    })
    dispatchMetaEvent({
      type: 'intent_preview',
      data: {
        displayAnchor: '湖北大学',
        targetCategory: '咖啡店',
        confidence: 0.92,
      },
      aiMessageIndex: 0,
    })
    dispatchMetaEvent({
      type: 'stage',
      data: { name: 'tool_run' },
      aiMessageIndex: 0,
    })
    dispatchMetaEvent({
      type: 'refined_result',
      data: {
        results: {
          boundary: { type: 'Polygon' },
          stats: { cluster_count: 1 },
          tool_calls: [
            {
              skill: 'postgis',
              action: 'viewport_poi_scan',
              status: 'done',
            },
          ],
        },
      },
      aiMessageIndex: 0,
    })

    const message = messagesRef.value[0]

    expect(message.thinkingMessage).toBe('已识别：湖北大学 · 咖啡店')
    expect(message.agentEvents.map((item) => item.title)).toEqual([
      '识别问题',
      '执行检索',
      '汇总证据并生成回答',
    ])
    expect(message.toolCalls).toHaveLength(1)
    expect(message.toolCalls[0]).toMatchObject({
      skill: 'postgis',
      action: 'viewport_poi_scan',
    })
    expect(emitted.some((item) => item.eventName === 'ai-boundary')).toBe(true)
  })
})
