import { randomUUID } from 'node:crypto'

import type { LLMCompletionRequest, LLMAssistantMessage, LLMProvider, LLMResponse } from './types.js'

function getLastUserText(messages: LLMCompletionRequest['messages']) {
  const user = [...messages].reverse().find((message) => message.role === 'user')
  return String(user?.content || '')
}

function getFirstSystemText(messages: LLMCompletionRequest['messages']) {
  const system = messages.find((message) => message.role === 'system')
  return String(system?.content || '')
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

function hasTemplateResult(toolResults: Record<string, unknown>[], template: string) {
  return toolResults.some((item) => {
    const meta = item.meta as Record<string, unknown> | undefined
    return String(meta?.template || '') === template && Array.isArray(item.rows)
  })
}

function inferCategoryKey(query: string) {
  if (/咖啡/.test(query)) return 'coffee'
  if (/地铁|站点|站/.test(query)) return 'metro_station'
  if (/餐饮|美食|吃饭/.test(query)) return 'food'
  if (/超市|便利店|商超/.test(query)) return 'supermarket'
  return ''
}

function sanitizeAnchorLeadIn(anchor: string) {
  return anchor
    .replace(/^(?:请帮我看看|请帮我看下|请帮我看一下|请帮我|帮我看看|帮我看下|帮我看一下|帮我|请把|把|请快速|请直接|请|麻烦你|看看|看下|看一下|看一看|先看看|先看下|先看一下|解读一下|解读|分析一下|分析|总结一下|总结|梳理一下|梳理)\s*/u, '')
    .trim()
}

function extractAnchorBeforeMarker(query: string, marker: RegExp) {
  return sanitizeAnchorLeadIn(query.split(marker)[0]?.trim() || '')
}

function extractCompareAnchors(query: string) {
  const patterns = [
    /^(?:请把|把|请)?(?:比较|对比)\s*(.+?)(?:和|与|跟)(.+?)(?:附近|周边)?的/u,
    /^(?:请把|把|请)?(.+?)(?:和|与|跟)(.+?)做(?:一下|个)?对比/u,
  ]

  for (const pattern of patterns) {
    const match = query.match(pattern)
    if (!match) continue
    return {
      primary: sanitizeAnchorLeadIn(match[1] || ''),
      secondary: sanitizeAnchorLeadIn(match[2] || ''),
    }
  }

  return {
    primary: null,
    secondary: null,
  }
}

function isCurrentAreaQuery(query: string) {
  return /这里|这附近|这片区域|这片区|这个区域|这个片区|这一片|当前区域|当前片区|此处/.test(query)
}

function isAreaSummaryQuery(query: string) {
  return /解读|分析|读懂|总结|主导业态|活力热点|热点|异常点/.test(query)
}

function isStoreOpportunityQuery(query: string) {
  return /开店|开什么店|适合开什么店|值得优先考虑|补什么配套|补位|供给|需求|竞争/.test(query)
}

function needsAreaSemanticContext(query: string) {
  return /居住|商业|混合|片区类型|说明依据/.test(query)
    || isStoreOpportunityQuery(query)
    || isAreaSummaryQuery(query)
    || /配套|业态|缺口|机会/.test(query)
}

function buildIntentClassifierJson(query: string) {
  const hasSpatialView = /has_spatial_view:\s*true/i.test(query)
  const hasUserLocation = /has_user_location:\s*true/i.test(query)
  const rawQueryMatch = query.match(/user_query:\s*(.+)/)
  const rawQuery = String(rawQueryMatch?.[1] || query).trim()
  const nearbyAnchor = /附近|周边/.test(rawQuery) ? extractAnchorBeforeMarker(rawQuery, /附近|周边/) : null
  const nearestAnchor = /最近/.test(rawQuery) ? extractAnchorBeforeMarker(rawQuery, /最近/) : null
  const compareAnchors = extractCompareAnchors(rawQuery)

  if (/相似|气质/.test(rawQuery)) {
    return {
      queryType: 'similar_regions',
      anchorSource: 'place',
      placeName: nearbyAnchor,
      secondaryPlaceName: null,
      needsClarification: !/武汉大学|湖北大学|光谷|大学|商圈/.test(rawQuery),
      clarificationHint: null,
    }
  }

  if (/比较|对比/.test(rawQuery)) {
    return {
      queryType: 'compare_places',
      anchorSource: hasSpatialView ? 'map_view' : 'place',
      placeName: hasSpatialView ? null : compareAnchors.primary,
      secondaryPlaceName: hasSpatialView ? null : compareAnchors.secondary,
      needsClarification: false,
      clarificationHint: null,
    }
  }

  if (/最近/.test(rawQuery) && /地铁|站/.test(rawQuery)) {
    return {
      queryType: 'nearest_station',
      anchorSource: hasUserLocation ? 'user_location' : 'place',
      placeName: hasUserLocation ? null : nearestAnchor,
      secondaryPlaceName: null,
      categoryKey: 'metro_station',
      targetCategory: '地铁站',
      needsClarification: false,
      clarificationHint: null,
    }
  }

  if (/解读|分析|读懂|看看.*区域|这片区域|这片区|当前区域|当前片区|这里|此处/.test(rawQuery)) {
    return {
      queryType: 'area_overview',
      anchorSource: hasSpatialView ? 'map_view' : hasUserLocation ? 'user_location' : 'place',
      placeName: hasSpatialView || hasUserLocation ? null : nearbyAnchor,
      secondaryPlaceName: null,
      targetCategory: '区域洞察',
      needsClarification: !hasSpatialView && !hasUserLocation && !/大学|商圈|步行街/.test(rawQuery),
      clarificationHint: null,
    }
  }

  if (/附近|周边/.test(rawQuery)) {
    return {
      queryType: 'nearby_poi',
      anchorSource: hasUserLocation ? 'user_location' : 'place',
      placeName: hasUserLocation ? null : nearbyAnchor,
      secondaryPlaceName: null,
      categoryKey: inferCategoryKey(rawQuery) || null,
      needsClarification: false,
      clarificationHint: null,
    }
  }

  return {
    queryType: 'unsupported',
    anchorSource: 'unknown',
    needsClarification: true,
    clarificationHint: null,
  }
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
    const systemPrompt = getFirstSystemText(request.messages)
    const query = getLastUserText(request.messages)
    const toolResults = getToolResults(request.messages)
    const hasAnchor = toolResults.some((item) => Boolean(item.anchor))
    const hasSql = toolResults.some((item) => Array.isArray(item.rows))
    const hasRegions = toolResults.some((item) => Array.isArray(item.regions))
    const hasComparison = toolResults.some((item) => Array.isArray(item.comparison_pairs))

    if (/GeoLoom V4 的意图理解器/.test(systemPrompt)) {
      return this.createResponse({
        content: JSON.stringify(buildIntentClassifierJson(query)),
        finishReason: 'stop',
      })
    }

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

    if (isAreaSummaryQuery(query) || /业态|供给|需求|竞争|开店|机会|配套|居住|商业|混合|片区类型|说明依据/.test(query)) {
      const useCurrentArea = isCurrentAreaQuery(query)
      const areaCategoryKey = inferCategoryKey(query)
      const includeSemanticContext = needsAreaSemanticContext(query)

      if (!useCurrentArea && !hasAnchor) {
        const anchor = extractAnchorBeforeMarker(query, /附近|周边/)
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

      const missingAreaCalls = ([
        ['area_category_histogram', 8],
        ['area_ring_distribution', 8],
        ['area_representative_sample', 18],
        ['area_competition_density', 8],
        ['area_h3_hotspots', 5],
        ...(includeSemanticContext
          ? [
              ['area_aoi_context', 5],
              ['area_landuse_context', 6],
            ]
          : []),
      ] as unknown as readonly [string, number][]).filter(([template]) => !hasTemplateResult(toolResults, template))

      if (missingAreaCalls.length > 0) {
        return this.createResponse({
          finishReason: 'tool_calls',
          toolCalls: missingAreaCalls.map(([template, limit]) => ({
            id: randomUUID(),
            name: 'postgis',
            arguments: {
              action: 'execute_spatial_sql',
              payload: {
                template,
                category_key: areaCategoryKey,
                limit,
              },
            },
          })),
        })
      }

      return this.createResponse({ finishReason: 'stop' })
    }

    if (/附近|周边/.test(query)) {
      if (!hasAnchor) {
        const anchor = extractAnchorBeforeMarker(query, /附近|周边/)
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
        const anchor = extractAnchorBeforeMarker(query, /最近/)
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
