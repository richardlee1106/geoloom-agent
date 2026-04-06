export type DependencyMode = 'remote' | 'fallback' | 'local' | 'unconfigured'

export interface DependencyStatus {
  name: string
  ready: boolean
  mode: DependencyMode
  degraded: boolean
  reason?: string | null
  target?: string | null
  details?: Record<string, unknown>
}

export function createDependencyStatus(input: DependencyStatus): DependencyStatus {
  return {
    ...input,
    reason: input.reason ?? null,
    target: input.target ?? null,
    details: input.details,
  }
}
