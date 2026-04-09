import type { EvidenceView, ResolvedAnchor, ToolExecutionTrace } from '../chat/types.js'

export interface SessionRecord {
  id: string
  requestId: string
  createdAt: string
  updatedAt: string
}

export interface MemoryTurn {
  traceId: string
  userQuery: string
  answer: string
  intent?: Record<string, unknown>
  createdAt: string
}

export interface MemorySnapshot {
  sessionId: string
  summary: string
  recentTurns: MemoryTurn[]
  turns: MemoryTurn[]
}

export interface ProfilesSnapshot {
  soul: string
  user: string
}

export interface ConfidenceDecision {
  status: 'allow' | 'clarify' | 'degraded'
  reason: 'ok' | 'unresolved_anchor' | 'insufficient_evidence' | 'conflicting_evidence'
  message?: string | null
}

export interface SpatialAnalysisRegion {
  id?: string | number | null
  name: string
  areaWkt: string
  lon?: number
  lat?: number
}

export interface SpatialAnalysisConstraint {
  scope: 'regions' | 'boundary' | 'viewport' | 'circle' | 'anchor_radius'
  areaWkt?: string | null
  selectedCategories: string[]
  regions: SpatialAnalysisRegion[]
}

export interface AgentTurnState {
  requestId: string
  traceId: string
  sessionId: string
  toolCalls: ToolExecutionTrace[]
  anchors: Partial<Record<string, ResolvedAnchor>>
  evidenceView?: EvidenceView
  spatialConstraint?: SpatialAnalysisConstraint
  sqlValidationAttempts: number
  sqlValidationPassed: number
}
