type PlainObject = Record<string, unknown>

export interface HealthDependency {
  key: string
  name: string
  ready: boolean
  mode: string
  degraded: boolean
  reason: string | null
}

export interface HealthState {
  status: string
  version: string
  providerReady: boolean
  llm: PlainObject
  memory: PlainObject
  degradedDependencies: string[]
  dependencies: HealthDependency[]
  skillsRegistered: number
  skills: unknown[]
  metrics: PlainObject | null
}

function isPlainObject(value: unknown): value is PlainObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function toStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => String(item || '').trim())
    .filter(Boolean)
}

function normalizeDependencyEntry([key, value]: [string, unknown]): HealthDependency {
  const dependency = isPlainObject(value) ? value : {}
  return {
    key,
    name: String(dependency.name || key),
    ready: dependency.ready !== false,
    mode: String(dependency.mode || 'unknown'),
    degraded: Boolean(dependency.degraded),
    reason: dependency.reason ? String(dependency.reason) : null
  }
}

export function normalizeHealthState(payload: unknown = {}): HealthState {
  const safePayload = isPlainObject(payload) ? payload : {}
  const dependencyMap = isPlainObject(safePayload.dependencies) ? safePayload.dependencies : {}

  return {
    status: String(safePayload.status || 'unknown'),
    version: String(safePayload.version || 'unknown'),
    providerReady: safePayload.provider_ready === true,
    llm: isPlainObject(safePayload.llm) ? safePayload.llm : { ready: false },
    memory: isPlainObject(safePayload.memory) ? safePayload.memory : { ready: false },
    degradedDependencies: toStringList(safePayload.degraded_dependencies),
    dependencies: Object.entries(dependencyMap).map(normalizeDependencyEntry),
    skillsRegistered: Number(safePayload.skills_registered || 0),
    skills: Array.isArray(safePayload.skills) ? safePayload.skills : [],
    metrics: isPlainObject(safePayload.metrics) ? safePayload.metrics : null
  }
}
