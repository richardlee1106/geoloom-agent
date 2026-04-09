import type { Logger } from '../utils/logger.js'
import type { DependencyStatus } from '../integration/dependencyStatus.js'

export interface JsonSchema {
  type: string
  properties?: Record<string, unknown>
  required?: string[]
  items?: unknown
  additionalProperties?: boolean
  oneOf?: JsonSchema[]
  anyOf?: JsonSchema[]
  enum?: unknown[]
  const?: unknown
  description?: string
  [key: string]: unknown
}

export interface SkillActionDefinition {
  name: string
  description: string
  inputSchema: JsonSchema
  outputSchema: JsonSchema
}

export interface SkillExecutionMeta {
  action: string
  audited: boolean
  latencyMs?: number
  traceId?: string
  [key: string]: unknown
}

export interface SkillError {
  code: string
  message: string
  details?: unknown
}

export interface SkillExecutionResult<TData = any> {
  ok: boolean
  data?: TData
  error?: SkillError
  meta: SkillExecutionMeta
}

export interface SkillExecutionContext {
  traceId: string
  requestId: string
  sessionId?: string
  logger: Logger
}

export interface SkillDefinition {
  name: string
  description: string
  actions: Record<string, SkillActionDefinition>
  capabilities: string[]
  getStatus?(): Promise<Record<string, DependencyStatus>> | Record<string, DependencyStatus>
  execute(
    action: string,
    payload: unknown,
    context: SkillExecutionContext,
  ): Promise<SkillExecutionResult<any>>
}

export interface SkillSummary {
  name: string
  description: string
  capabilities: string[]
  actions: SkillActionDefinition[]
}
