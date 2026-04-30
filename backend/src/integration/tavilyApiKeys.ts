const TAVILY_KEY_FAILOVER_STATUS_CODES = new Set([401, 403, 429, 432])

export interface TavilyKeyAttemptContext {
  keyIndex: number
  totalKeys: number
  keyLabel: string
}

export interface TavilyRequestErrorOptions {
  statusCode?: number | null
  responseBody?: string | null
  keyLabel?: string | null
  canFailover?: boolean
}

export class TavilyRequestError extends Error {
  readonly statusCode: number | null
  readonly responseBody: string | null
  readonly keyLabel: string | null
  readonly canFailover: boolean

  constructor(message: string, options: TavilyRequestErrorOptions = {}) {
    super(message)
    this.name = 'TavilyRequestError'
    this.statusCode = options.statusCode ?? null
    this.responseBody = options.responseBody ?? null
    this.keyLabel = options.keyLabel ?? null
    this.canFailover = Boolean(options.canFailover)
  }
}

export function normalizeTavilyApiKeys(values: Iterable<unknown>) {
  const seen = new Set<string>()
  const result: string[] = []

  for (const value of values) {
    const normalized = String(value || '').trim()
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    result.push(normalized)
  }

  return result
}

export function resolveTavilyApiKeys(env: NodeJS.ProcessEnv = process.env) {
  const numberedKeys = Object.keys(env)
    .filter((key) => /^TAVILY_API_KEY\d+$/u.test(key))
    .sort((left, right) => {
      const leftIndex = Number(left.replace('TAVILY_API_KEY', ''))
      const rightIndex = Number(right.replace('TAVILY_API_KEY', ''))
      return leftIndex - rightIndex
    })

  return normalizeTavilyApiKeys([
    env.TAVILY_API_KEY,
    ...numberedKeys.map((key) => env[key]),
  ])
}

export function maskTavilyApiKey(apiKey: string) {
  const normalized = String(apiKey || '').trim()
  if (!normalized) return 'missing'
  if (normalized.length <= 12) return `${normalized.slice(0, 4)}***`
  return `${normalized.slice(0, 8)}***${normalized.slice(-4)}`
}

export function createTavilyHttpError(statusCode: number, responseBody: string, keyLabel: string) {
  const summary = responseBody.trim().slice(0, 160)
  const message = summary
    ? `Tavily request failed with HTTP ${statusCode}: ${summary}`
    : `Tavily request failed with HTTP ${statusCode}`

  return new TavilyRequestError(message, {
    statusCode,
    responseBody,
    keyLabel,
    canFailover: TAVILY_KEY_FAILOVER_STATUS_CODES.has(statusCode),
  })
}

export function normalizeTavilyRequestError(error: unknown, fallbackKeyLabel?: string | null) {
  if (error instanceof TavilyRequestError) {
    return error
  }

  if (error instanceof Error) {
    return new TavilyRequestError(error.message, {
      keyLabel: fallbackKeyLabel ?? null,
      canFailover: false,
      responseBody: null,
      statusCode: null,
    })
  }

  return new TavilyRequestError(String(error || 'Unknown Tavily error'), {
    keyLabel: fallbackKeyLabel ?? null,
    canFailover: false,
    responseBody: null,
    statusCode: null,
  })
}

export async function withTavilyApiKeyFailover<T>(input: {
  apiKeys: string[]
  startIndex?: number
  operation: (apiKey: string, context: TavilyKeyAttemptContext) => Promise<T>
  onKeyError?: (error: TavilyRequestError, context: TavilyKeyAttemptContext) => void
}) {
  const apiKeys = normalizeTavilyApiKeys(input.apiKeys)
  if (apiKeys.length === 0) {
    throw new TavilyRequestError('Tavily API key is not configured', {
      canFailover: false,
      keyLabel: null,
      statusCode: null,
      responseBody: null,
    })
  }

  const startIndex = Number.isInteger(input.startIndex)
    ? Math.max(0, Math.min(Number(input.startIndex), apiKeys.length - 1))
    : 0

  let lastError: TavilyRequestError | null = null
  for (let offset = 0; offset < apiKeys.length; offset += 1) {
    const keyIndex = (startIndex + offset) % apiKeys.length
    const apiKey = apiKeys[keyIndex]
    const context: TavilyKeyAttemptContext = {
      keyIndex,
      totalKeys: apiKeys.length,
      keyLabel: maskTavilyApiKey(apiKey),
    }

    try {
      const result = await input.operation(apiKey, context)
      return { result, keyIndex, keyLabel: context.keyLabel }
    } catch (error) {
      const normalizedError = normalizeTavilyRequestError(error, context.keyLabel)
      lastError = normalizedError
      input.onKeyError?.(normalizedError, context)
      if (!normalizedError.canFailover) {
        throw normalizedError
      }
    }
  }

  throw lastError || new TavilyRequestError('Tavily request failed after exhausting all keys', {
    canFailover: false,
    keyLabel: null,
    statusCode: null,
    responseBody: null,
  })
}
