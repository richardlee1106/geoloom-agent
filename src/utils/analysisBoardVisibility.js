function resolveMessageQueryType(message) {
  return String(
    message?.queryType ||
    message?.intentMeta?.queryType ||
    ''
  ).trim().toLowerCase()
}

function resolveMessageIntentMode(message) {
  return String(
    message?.intentMeta?.intentMode ||
    message?.intentMode ||
    ''
  ).trim().toLowerCase()
}

function resolveQueryPlan(message) {
  const queryPlan = message?.intentMeta?.queryPlan
  return queryPlan && typeof queryPlan === 'object' ? queryPlan : null
}

function hasSpatialReasoningPlan(message) {
  const queryPlan = resolveQueryPlan(message)
  if (!queryPlan) return false

  const taskType = String(queryPlan.task_type || queryPlan.taskType || '').trim().toLowerCase()
  const answerType = String(queryPlan.answer_type || queryPlan.answerType || '').trim().toLowerCase()
  const intentMode = String(queryPlan.intent_mode || queryPlan.intentMode || '').trim().toLowerCase()

  if (taskType && taskType !== 'general_qa' && taskType !== 'smalltalk') return true
  if (answerType && answerType !== 'general_qa' && answerType !== 'smalltalk') return true
  if (intentMode === 'macro_overview' || intentMode === 'local_search') return true

  return false
}

export function isGeneralQaMessage(message) {
  const queryType = resolveMessageQueryType(message)
  const intentMode = resolveMessageIntentMode(message)

  if (intentMode === 'macro_overview' || intentMode === 'local_search') {
    return false
  }

  if (hasSpatialReasoningPlan(message)) {
    return false
  }

  if (queryType === 'general_qa' || queryType === 'irrelevant_input') {
    return true
  }

  if (intentMode === 'llm_chat' || intentMode === 'out_of_scope') {
    return true
  }

  return false
}

export function shouldShowAnalysisBoard(message, { isV3Mode = false } = {}) {
  if (!message || isV3Mode) return false
  return !isGeneralQaMessage(message)
}

export default {
  isGeneralQaMessage,
  shouldShowAnalysisBoard
}
