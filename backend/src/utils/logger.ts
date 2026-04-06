export interface Logger {
  info(message: string, meta?: Record<string, unknown>): void
  warn(message: string, meta?: Record<string, unknown>): void
  error(message: string, meta?: Record<string, unknown>): void
  debug(message: string, meta?: Record<string, unknown>): void
  child(meta: Record<string, unknown>): Logger
}

class ConsoleLogger implements Logger {
  constructor(private readonly scope: Record<string, unknown> = {}) {}

  info(message: string, meta?: Record<string, unknown>) {
    console.info(message, this.merge(meta))
  }

  warn(message: string, meta?: Record<string, unknown>) {
    console.warn(message, this.merge(meta))
  }

  error(message: string, meta?: Record<string, unknown>) {
    console.error(message, this.merge(meta))
  }

  debug(message: string, meta?: Record<string, unknown>) {
    if (process.env.NODE_ENV !== 'test') {
      console.debug(message, this.merge(meta))
    }
  }

  child(meta: Record<string, unknown>) {
    return new ConsoleLogger(this.merge(meta))
  }

  private merge(meta?: Record<string, unknown>) {
    return {
      ...this.scope,
      ...(meta || {}),
    }
  }
}

export function createLogger(meta: Record<string, unknown> = {}): Logger {
  return new ConsoleLogger(meta)
}

