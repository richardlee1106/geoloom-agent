export interface RemoteClientOptions {
  baseUrl: string
  path: string
  method?: 'GET' | 'POST'
  body?: unknown
  timeoutMs: number
  fetchImpl?: typeof fetch
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, '')
}

function ensureLeadingSlash(value: string) {
  return value.startsWith('/') ? value : `/${value}`
}

export async function requestJson<TResponse>(options: RemoteClientOptions): Promise<TResponse> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs)

  try {
    const response = await (options.fetchImpl || fetch)(
      `${trimTrailingSlash(options.baseUrl)}${ensureLeadingSlash(options.path)}`,
      {
        method: options.method || 'GET',
        headers: options.method === 'POST'
          ? { 'Content-Type': 'application/json' }
          : undefined,
        body: options.body == null ? undefined : JSON.stringify(options.body),
        signal: controller.signal,
      },
    )

    if (!response.ok) {
      throw new Error(`remote_request_failed:${response.status}`)
    }

    return await response.json() as TResponse
  } finally {
    clearTimeout(timeout)
  }
}
