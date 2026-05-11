import { SPATIAL_API_BASE_URL } from '../../config'
import type { NarrativeAssistantRequest, NarrativeAssistantResponse, NarrativeEnrichmentJob, NarrativeEnrichmentMode, NarrativeExplorationControls, NarrativeLlmPromptVariantInput, NarrativeResponse, NarrationTone, UserContext, ViewportBBox } from './types'

export interface FetchNarrativeOptions {
  session_id?: string
  viewport: ViewportBBox
  tone?: NarrationTone
  user_context?: Partial<UserContext>
  exploration?: NarrativeExplorationControls
  limit?: number
  debug?: boolean
  enrichment_mode?: NarrativeEnrichmentMode
  /** @deprecated lite 已是唯一形态，此字段仅保留向后兼容 */
  prompt_variant?: NarrativeLlmPromptVariantInput
}

export interface NarrativeApiRequestOptions {
  signal?: AbortSignal
}

export interface NarrativeEnrichmentSubscription {
  close(): void
}

export interface SubscribeNarrativeEnrichmentOptions {
  onJob(job: NarrativeEnrichmentJob): void
  onError(error: Error): void
}

async function readNarrativeApiError(response: Response, fallback: string): Promise<string> {
  const contentType = String(response.headers.get('content-type') || '').toLowerCase()
  if (contentType.includes('application/json')) {
    const payload = await response.json().catch(() => null) as {
      error?: { code?: string; message?: string }
      message?: string
    } | null
    const code = String(payload?.error?.code || '').trim()
    const message = String(payload?.error?.message || payload?.message || '').trim()
    if (code && message) return `${code}: ${message}`
    if (message) return message
  }
  const text = await response.text().catch(() => '')
  return text || fallback
}

export async function fetchNarrativeResponse(options: FetchNarrativeOptions, requestOptions: NarrativeApiRequestOptions = {}): Promise<NarrativeResponse> {
  const response = await fetch(`${SPATIAL_API_BASE_URL}/api/narrative`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(options),
    signal: requestOptions.signal
  })

  if (!response.ok) {
    const detail = await readNarrativeApiError(response, 'narrative request failed')
    throw new Error(`narrative request failed (${response.status}): ${detail}`)
  }

  return await response.json() as NarrativeResponse
}

export async function fetchNarrativeEnrichmentJob(jobId: string, requestOptions: NarrativeApiRequestOptions = {}): Promise<NarrativeEnrichmentJob> {
  const response = await fetch(`${SPATIAL_API_BASE_URL}/api/narrative/enrichment/${encodeURIComponent(jobId)}`, {
    signal: requestOptions.signal
  })

  if (!response.ok) {
    const detail = await readNarrativeApiError(response, 'narrative enrichment request failed')
    throw new Error(`narrative enrichment request failed (${response.status}): ${detail}`)
  }

  return await response.json() as NarrativeEnrichmentJob
}

export function subscribeNarrativeEnrichmentJob(jobId: string, options: SubscribeNarrativeEnrichmentOptions): NarrativeEnrichmentSubscription {
  const source = new EventSource(`${SPATIAL_API_BASE_URL}/api/narrative/enrichment/${encodeURIComponent(jobId)}/events`)
  let closed = false
  const close = () => {
    if (closed) return
    closed = true
    source.close()
  }
  source.addEventListener('enrichment', (event) => {
    if (closed) return
    try {
      const job = JSON.parse(String((event as MessageEvent).data || '{}')) as NarrativeEnrichmentJob
      options.onJob(job)
      if (job.status === 'completed' || job.status === 'failed') close()
    } catch (error) {
      close()
      options.onError(error instanceof Error ? error : new Error('narrative enrichment stream parse failed'))
    }
  })
  source.addEventListener('error', () => {
    if (closed) return
    close()
    options.onError(new Error('narrative enrichment stream failed'))
  })
  source.onerror = () => {
    if (closed) return
    close()
    options.onError(new Error('narrative enrichment stream failed'))
  }
  return { close }
}

export async function sendNarrativeAssistantMessage(options: NarrativeAssistantRequest, requestOptions: NarrativeApiRequestOptions = {}): Promise<NarrativeAssistantResponse> {
  const response = await fetch(`${SPATIAL_API_BASE_URL}/api/narrative/assistant`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(options),
    signal: requestOptions.signal
  })

  if (!response.ok) {
    const detail = await readNarrativeApiError(response, 'narrative assistant request failed')
    throw new Error(`narrative assistant request failed (${response.status}): ${detail}`)
  }

  return await response.json() as NarrativeAssistantResponse
}

export interface SynthesizeNarrativeSpeechOptions {
  text: string
  voice?: string
  speed?: number
}

export async function synthesizeNarrativeSpeech(options: SynthesizeNarrativeSpeechOptions, requestOptions: NarrativeApiRequestOptions = {}): Promise<Blob> {
  const response = await fetch(`${SPATIAL_API_BASE_URL}/api/narrative/tts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(options),
    signal: requestOptions.signal
  })

  if (!response.ok) {
    const detail = await readNarrativeApiError(response, 'narrative tts request failed')
    throw new Error(`narrative tts request failed (${response.status}): ${detail}`)
  }

  return await response.blob()
}
