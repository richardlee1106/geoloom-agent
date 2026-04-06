function normalizeDependencyEntry([key, value]) {
  const dependency = value && typeof value === 'object' ? value : {}
  return {
    key,
    name: dependency.name || key,
    ready: dependency.ready !== false,
    mode: dependency.mode || 'unknown',
    degraded: Boolean(dependency.degraded),
    reason: dependency.reason || null,
  }
}

export function normalizeHealthState(payload = {}) {
  const dependencies = Object.entries(payload.dependencies || {}).map(normalizeDependencyEntry)

  return {
    status: payload.status || 'unknown',
    version: payload.version || 'unknown',
    providerReady: payload.provider_ready === true,
    llm: payload.llm && typeof payload.llm === 'object' ? payload.llm : { ready: false },
    memory: payload.memory && typeof payload.memory === 'object' ? payload.memory : { ready: false },
    degradedDependencies: Array.isArray(payload.degraded_dependencies) ? payload.degraded_dependencies : [],
    dependencies,
    skillsRegistered: Number(payload.skills_registered || 0),
    skills: Array.isArray(payload.skills) ? payload.skills : [],
    metrics: payload.metrics && typeof payload.metrics === 'object' ? payload.metrics : null,
  }
}
