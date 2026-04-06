import { describe, expect, it } from 'vitest'

import { isGeneralQaMessage, shouldShowAnalysisBoard } from '../analysisBoardVisibility.js'

describe('analysisBoardVisibility', () => {
  it('recognizes general qa messages from query type or intent mode', () => {
    expect(isGeneralQaMessage({ queryType: 'general_qa' })).toBe(true)
    expect(isGeneralQaMessage({ intentMeta: { intentMode: 'llm_chat' } })).toBe(true)
    expect(isGeneralQaMessage({ queryType: 'poi_search', intentMeta: { intentMode: 'local_search' } })).toBe(false)
  })

  it('does not treat spatial reasoning plans as general qa even if query type is general_qa', () => {
    const message = {
      queryType: 'general_qa',
      intentMeta: {
        intentMode: 'macro_overview',
        queryPlan: {
          task_type: 'support_gap_analysis',
          answer_type: 'support_gap_analysis',
          intent_mode: 'macro_overview'
        }
      }
    }

    expect(isGeneralQaMessage(message)).toBe(false)
  })

  it('hides the analysis board in v3 mode even when spatial evidence exists', () => {
    const message = {
      queryType: 'poi_search',
      intentMeta: { intentMode: 'local_search' },
      spatialClusters: { hotspots: [{ id: 'hotspot-1' }] }
    }

    expect(shouldShowAnalysisBoard(message, { isV3Mode: true })).toBe(false)
    expect(shouldShowAnalysisBoard(message, { isV3Mode: false })).toBe(true)
  })
})
