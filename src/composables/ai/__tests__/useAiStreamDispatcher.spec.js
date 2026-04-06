import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

import { useAiStreamDispatcher } from '../useAiStreamDispatcher.js'
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
})
