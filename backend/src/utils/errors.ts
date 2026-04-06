export interface ErrorPayload {
  code: string
  message: string
  details?: unknown
}

export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode = 400,
    public readonly details?: unknown,
  ) {
    super(message)
    this.name = 'AppError'
  }
}

export function toErrorPayload(error: unknown): ErrorPayload {
  if (error instanceof AppError) {
    return {
      code: error.code,
      message: error.message,
      details: error.details,
    }
  }

  if (error instanceof Error) {
    return {
      code: 'internal_error',
      message: error.message,
    }
  }

  return {
    code: 'internal_error',
    message: 'Unknown error',
  }
}

