import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

import { useAiStreamDispatcher } from '../useAiStreamDispatcher'
import { normalizeRefinedResultEvidence } from '../../../utils/refinedResultEvidence.js'

function setupDispatcher() {
  const messagesRef = ref([{ role: 'assistant', content: '' }])
  const extractedPOIsRef = ref([])
  const emit = vi.fn()

  const dispatcher = useAiStreamDispatcher({
    messagesRef,
    extractedPOIsRef,
    emit,
    normalizeRefinedResultEvidence,
    toEmbeddedIntentMode: () => ''
  })

  return {
    dispatcher,
    emit,
    messagesRef
  }
}

describe('useAiStreamDispatcher prefetch debug fields', () => {
  it('hydrates schema metadata from trace events', () => {
    const { dispatcher, messagesRef } = setupDispatcher()

    dispatcher.dispatchMetaEvent({
      type: 'trace',
      data: {
        request_id: 'req-42',
        schema_version: 'v4.1',
        capabilities: ['intent_meta', 'prefetch_debug']
      },
      aiMessageIndex: 0,
      fallbackIntentMode: 'macro'
    })

    expect(messagesRef.value[0].traceId).toBe('req-42')
    expect(messagesRef.value[0].schemaVersion).toBe('v4.1')
    expect(messagesRef.value[0].capabilities).toEqual(['intent_meta', 'prefetch_debug'])
  })

  it('stores prefetch debug info from stats event', () => {
    const { dispatcher, messagesRef } = setupDispatcher()

    dispatcher.dispatchMetaEvent({
      type: 'stats',
      data: {
        prefetch_degraded: true,
        prefetch_wasted: false,
        prefetch_overlap_delta_ms: -42
      },
      aiMessageIndex: 0,
      fallbackIntentMode: 'macro'
    })

    expect(messagesRef.value[0].prefetchDebug).toEqual({
      degraded: true,
      wasted: false,
      overlapDeltaMs: -42,
      status: 'degraded'
    })
  })

  it('stores prefetch debug info from refined_result event', () => {
    const { dispatcher, messagesRef } = setupDispatcher()

    dispatcher.dispatchMetaEvent({
      type: 'refined_result',
      data: {
        results: {
          stats: {
            prefetch_degraded: false,
            prefetch_wasted: true,
            prefetch_overlap_delta_ms: -120
          }
        }
      },
      aiMessageIndex: 0,
      fallbackIntentMode: 'macro'
    })

    expect(messagesRef.value[0].prefetchDebug).toEqual({
      degraded: false,
      wasted: true,
      overlapDeltaMs: -120,
      status: 'wasted'
    })
  })

  it('keeps assistant message in thinking state until the outer stream finalizer completes', () => {
    const { dispatcher, messagesRef } = setupDispatcher()
    messagesRef.value[0] = {
      role: 'assistant',
      content: '',
      isThinking: true,
      isStreaming: true
    }

    dispatcher.dispatchMetaEvent({
      type: 'thinking',
      data: {
        status: 'end',
        message: '证据整理完成，正在生成结果...'
      },
      aiMessageIndex: 0,
      fallbackIntentMode: 'macro'
    })

    expect(messagesRef.value[0].isThinking).toBe(true)
    expect(messagesRef.value[0].thinkingMessage).toBe('证据整理完成，正在生成结果...')
  })
})
