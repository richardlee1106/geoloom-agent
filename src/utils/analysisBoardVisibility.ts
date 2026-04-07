type PlainObject = Record<string, unknown>

interface MessageLike extends PlainObject {
  queryType?: unknown
  intentMode?: unknown
  intentMeta?: PlainObject | null
}

function asPlainObject(value: unknown): PlainObject | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as PlainObject)
    : null
}

function asMessageLike(message: unknown): MessageLike {
  return asPlainObject(message) as MessageLike || {}
}

function resolveMessageQueryType(message: unknown): string {
  const safeMessage = asMessageLike(message)
  const intentMeta = asPlainObject(safeMessage.intentMeta)
  return String(
    safeMessage.queryType ||
    intentMeta?.queryType ||
    ''
  ).trim().toLowerCase()
}

function resolveMessageIntentMode(message: unknown): string {
  const safeMessage = asMessageLike(message)
  const intentMeta = asPlainObject(safeMessage.intentMeta)
  return String(
    intentMeta?.intentMode ||
    safeMessage.intentMode ||
    ''
  ).trim().toLowerCase()
}

function resolveQueryPlan(message: unknown): PlainObject | null {
  const safeMessage = asMessageLike(message)
  const intentMeta = asPlainObject(safeMessage.intentMeta)
  const queryPlan = intentMeta?.queryPlan
  return asPlainObject(queryPlan)
}

function hasSpatialReasoningPlan(message: unknown): boolean {
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

export function isGeneralQaMessage(message: unknown): boolean {
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

export function shouldShowAnalysisBoard(
  message: unknown,
  { isV3Mode = false }: { isV3Mode?: boolean } = {}
): boolean {
  if (!message || isV3Mode) return false
  return !isGeneralQaMessage(message)
}

export default {
  isGeneralQaMessage,
  shouldShowAnalysisBoard
}
