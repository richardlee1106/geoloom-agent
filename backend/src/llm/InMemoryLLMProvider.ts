import { randomUUID } from 'node:crypto'

import type { LLMCompletionRequest, LLMAssistantMessage, LLMProvider, LLMResponse } from './types.js'

function getLastUserText(messages: LLMCompletionRequest['messages']) {
  const user = [...messages].reverse().find((message) => message.role === 'user')
  return String(user?.content || '')
}

function getToolResults(messages: LLMCompletionRequest['messages']) {
  return messages.filter((message) => message.role === 'tool').map((message) => {
    try {
      return JSON.parse(message.content || '{}') as Record<string, unknown>
    } catch {
      return {}
    }
  })
}

export class InMemoryLLMProvider implements LLMProvider {
  private createResponse(input: {
    content?: string | null
    toolCalls?: LLMResponse['toolCalls']
    finishReason: LLMResponse['finishReason']
  }): LLMResponse {
    const toolCalls = input.toolCalls || []
    const assistantMessage: LLMAssistantMessage = {
      role: 'assistant',
      content: input.content ?? null,
      toolCalls,
    }

    return {
      assistantMessage,
      toolCalls,
      finishReason: input.finishReason,
    }
  }

  getStatus() {
    return {
      ready: true,
      model: 'in-memory',
      provider: 'in-memory',
    }
  }

  isReady() {
    return true
  }

  async complete(request: LLMCompletionRequest): Promise<LLMResponse> {
    const query = getLastUserText(request.messages)
    const toolResults = getToolResults(request.messages)
    const hasAnchor = toolResults.some((item) => Boolean(item.anchor))
    const hasSql = toolResults.some((item) => Array.isArray(item.rows))
    const hasRegions = toolResults.some((item) => Array.isArray(item.regions))
    const hasComparison = toolResults.some((item) => Array.isArray(item.comparison_pairs))

    if (/比较|对比/.test(query) && /武汉大学/.test(query) && /湖北大学/.test(query)) {
      if (!toolResults.some((item) => item.anchor && item.role === 'primary')) {
        return this.createResponse({
          finishReason: 'tool_calls',
          toolCalls: [
            {
              id: randomUUID(),
              name: 'postgis',
              arguments: {
                action: 'resolve_anchor',
                payload: {
                  place_name: '武汉大学',
                  role: 'primary',
                },
              },
            },
            {
              id: randomUUID(),
              name: 'postgis',
              arguments: {
                action: 'resolve_anchor',
                payload: {
                  place_name: '湖北大学',
                  role: 'secondary',
                },
              },
            },
          ],
        })
      }

      if (!hasComparison) {
        return this.createResponse({
          finishReason: 'tool_calls',
          toolCalls: [
            {
              id: randomUUID(),
              name: 'postgis',
              arguments: {
                action: 'execute_spatial_sql',
                payload: {
                  template: 'compare_places',
                  category_key: 'food',
                },
              },
            },
          ],
        })
      }

      return this.createResponse({ finishReason: 'stop' })
    }

    if (/相似|气质/.test(query)) {
      if (!hasRegions) {
        return this.createResponse({
          finishReason: 'tool_calls',
          toolCalls: [
            {
              id: randomUUID(),
              name: 'spatial_vector',
              arguments: {
                action: 'search_similar_regions',
                payload: {
                  text: query,
                  top_k: 3,
                },
              },
            },
          ],
        })
      }

      return this.createResponse({ finishReason: 'stop' })
    }

    if (/附近|周边/.test(query)) {
      if (!hasAnchor) {
        const anchor = query.split(/附近|周边/)[0]?.trim() || ''
        return this.createResponse({
          finishReason: 'tool_calls',
          toolCalls: [
            {
              id: randomUUID(),
              name: 'postgis',
              arguments: {
                action: 'resolve_anchor',
                payload: {
                  place_name: anchor,
                  role: 'primary',
                },
              },
            },
          ],
        })
      }

      if (!hasSql) {
        return this.createResponse({
          finishReason: 'tool_calls',
          toolCalls: [
            {
              id: randomUUID(),
              name: 'postgis',
              arguments: {
                action: 'execute_spatial_sql',
                payload: {
                  template: 'nearby_poi',
                  category_key: /咖啡/.test(query) ? 'coffee' : 'nearby',
                },
              },
            },
          ],
        })
      }

      return this.createResponse({ finishReason: 'stop' })
    }

    if (/最近/.test(query) && /地铁|站/.test(query)) {
      if (!hasAnchor) {
        const anchor = query.split(/最近/)[0]?.trim() || ''
        return this.createResponse({
          finishReason: 'tool_calls',
          toolCalls: [
            {
              id: randomUUID(),
              name: 'postgis',
              arguments: {
                action: 'resolve_anchor',
                payload: {
                  place_name: anchor,
                  role: 'primary',
                },
              },
            },
          ],
        })
      }

      if (!hasSql) {
        return this.createResponse({
          finishReason: 'tool_calls',
          toolCalls: [
            {
              id: randomUUID(),
              name: 'postgis',
              arguments: {
                action: 'execute_spatial_sql',
                payload: {
                  template: 'nearest_station',
                  category_key: 'metro_station',
                },
              },
            },
          ],
        })
      }

      return this.createResponse({ finishReason: 'stop' })
    }

    return this.createResponse({ finishReason: 'stop' })
  }
}
