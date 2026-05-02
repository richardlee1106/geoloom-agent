import { SPATIAL_API_BASE_URL } from '../../config'
import type { NarrativeResponse, NarrationTone, UserContext, ViewportBBox } from './types'

export interface FetchNarrativeOptions {
  session_id?: string
  viewport: ViewportBBox
  tone?: NarrationTone
  user_context?: Partial<UserContext>
  limit?: number
  debug?: boolean
}

export async function fetchNarrativeResponse(options: FetchNarrativeOptions): Promise<NarrativeResponse> {
  const response = await fetch(`${SPATIAL_API_BASE_URL}/api/narrative`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(options)
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`narrative request failed (${response.status})${text ? `: ${text}` : ''}`)
  }

  return await response.json() as NarrativeResponse
}
