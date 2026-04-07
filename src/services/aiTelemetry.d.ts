export function getTelemetrySessionId(): string
export function resetTelemetrySessionId(): string
export function getTemplateWeightsSnapshot(): {
  version: string
  loadedAt: number
  weights: Record<string, number>
}
export function getTemplateWeight(templateId: string): number
export function refreshTemplateWeights(options?: {
  ttlMs?: number
  force?: boolean
}): Promise<{
  version: string
  loadedAt: number
  weights: Record<string, number>
}>
export function sendTemplateFeedback(eventType: string, payload?: Record<string, unknown>): Promise<boolean>
export function trackTemplateImpression(payload: Record<string, unknown>): Promise<boolean>
export function trackTemplateClick(payload: Record<string, unknown>): Promise<boolean>
export function trackLocateClick(payload: Record<string, unknown>): Promise<boolean>
export function trackFollowupClick(payload: Record<string, unknown>): Promise<boolean>
export function trackSessionOutcome(payload: Record<string, unknown>): Promise<boolean>

declare const aiTelemetry: {
  getTelemetrySessionId: typeof getTelemetrySessionId
  resetTelemetrySessionId: typeof resetTelemetrySessionId
  getTemplateWeightsSnapshot: typeof getTemplateWeightsSnapshot
  getTemplateWeight: typeof getTemplateWeight
  refreshTemplateWeights: typeof refreshTemplateWeights
  sendTemplateFeedback: typeof sendTemplateFeedback
  trackTemplateImpression: typeof trackTemplateImpression
  trackTemplateClick: typeof trackTemplateClick
  trackLocateClick: typeof trackLocateClick
  trackFollowupClick: typeof trackFollowupClick
  trackSessionOutcome: typeof trackSessionOutcome
}

export default aiTelemetry
