export type DependencyMode = 'remote' | 'fallback' | 'local' | 'unconfigured'
export type SemanticEvidenceLevel = 'available' | 'degraded' | 'unavailable'

export interface DependencyStatus {
  name: string
  ready: boolean
  mode: DependencyMode
  degraded: boolean
  reason?: string | null
  target?: string | null
  details?: Record<string, unknown>
}

export interface SemanticEvidenceStatus {
  dependency: string
  level: SemanticEvidenceLevel
  weakEvidence: boolean
  mode: DependencyMode
  reason?: string | null
  target?: string | null
}

export function createDependencyStatus(input: DependencyStatus): DependencyStatus {
  return {
    ...input,
    reason: input.reason ?? null,
    target: input.target ?? null,
    details: input.details,
  }
}

export function toSemanticEvidenceStatus(status?: DependencyStatus | null): SemanticEvidenceStatus {
  if (!status) {
    return {
      dependency: 'unknown',
      level: 'unavailable',
      weakEvidence: true,
      mode: 'unconfigured',
      reason: 'dependency_status_missing',
      target: null,
    }
  }

  if (!status.ready) {
    return {
      dependency: status.name,
      level: 'unavailable',
      weakEvidence: true,
      mode: status.mode,
      reason: status.reason ?? 'dependency_unavailable',
      target: status.target ?? null,
    }
  }

  const level: SemanticEvidenceLevel = !status.degraded && status.mode === 'remote'
    ? 'available'
    : 'degraded'

  return {
    dependency: status.name,
    level,
    weakEvidence: level !== 'available',
    mode: status.mode,
    reason: status.reason ?? null,
    target: status.target ?? null,
  }
}

export function mergeSemanticEvidenceStatuses(
  statuses: Array<SemanticEvidenceStatus | null | undefined>,
): SemanticEvidenceStatus | undefined {
  const normalized = statuses.filter((status): status is SemanticEvidenceStatus => Boolean(status))
  if (normalized.length === 0) {
    return undefined
  }

  const degraded = normalized.find((status) => status.level === 'degraded')
  if (degraded) {
    return degraded
  }

  const available = normalized.find((status) => status.level === 'available')
  if (available) {
    return available
  }

  return normalized[0]
}

export function isStrongSemanticEvidence(status?: SemanticEvidenceStatus | null) {
  return Boolean(status && status.level === 'available' && !status.weakEvidence)
}
