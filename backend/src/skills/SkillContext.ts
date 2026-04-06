import { randomUUID } from 'node:crypto'

import { createLogger, type Logger } from '../utils/logger.js'
import type { SkillExecutionContext } from './types.js'

export interface CreateSkillContextOptions {
  traceId?: string
  requestId?: string
  sessionId?: string
  logger?: Logger
}

export function createSkillExecutionContext(
  options: CreateSkillContextOptions = {},
): SkillExecutionContext {
  const traceId = options.traceId || randomUUID()
  const requestId = options.requestId || randomUUID()
  const logger = (options.logger || createLogger()).child({
    traceId,
    requestId,
    sessionId: options.sessionId || null,
  })

  return {
    traceId,
    requestId,
    sessionId: options.sessionId,
    logger,
  }
}

