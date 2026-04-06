import { randomUUID } from 'node:crypto'
import type { Writable } from 'node:stream'

import { EvidenceViewFactory } from '../evidence/EvidenceViewFactory.js'
import { Renderer } from '../evidence/Renderer.js'
import { createSkillExecutionContext } from '../skills/SkillContext.js'
import type { SkillRegistry } from '../skills/SkillRegistry.js'
import type { SkillDefinition } from '../skills/types.js'
import { createLogger } from '../utils/logger.js'
import { DeterministicRouter } from './DeterministicRouter.js'
import { SSEWriter } from './SSEWriter.js'
import type {
  ChatRequestV4,
  DeterministicIntent,
  EvidenceItem,
  ResolvedAnchor,
} from './types.js'

const SCHEMA_VERSION = 'v4.det.v1'

function hasAnchorCoordinates(anchor: ResolvedAnchor) {
  return Number.isFinite(anchor.lon) && Number.isFinite(anchor.lat)
}

function formatNumericLiteral(value: unknown, fallback = 0) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? String(numeric) : String(fallback)
}

function normalizePoiRows(rows: Record<string, unknown>[] = []): EvidenceItem[] {
  return rows.map((row) => ({
    id: (row.id as string | number | null | undefined) ?? null,
    name: String(row.name || '').trim() || '未命名地点',
    category: String(row.category_sub || row.category_main || row.category || '').trim() || null,
    categoryMain: String(row.category_main || '').trim() || null,
    categorySub: String(row.category_sub || '').trim() || null,
    longitude: Number.isFinite(Number(row.longitude)) ? Number(row.longitude) : undefined,
    latitude: Number.isFinite(Number(row.latitude)) ? Number(row.latitude) : undefined,
    distance_m: Number.isFinite(Number(row.distance_m)) ? Number(row.distance_m) : null,
  }))
}

export interface DeterministicGeoChatOptions {
  registry: SkillRegistry
  version: string
  router?: DeterministicRouter
  evidenceFactory?: EvidenceViewFactory
  renderer?: Renderer
}

export class DeterministicGeoChat {
  private readonly router: DeterministicRouter
  private readonly evidenceFactory: EvidenceViewFactory
  private readonly renderer: Renderer

  constructor(private readonly options: DeterministicGeoChatOptions) {
    this.router = options.router || new DeterministicRouter()
    this.evidenceFactory = options.evidenceFactory || new EvidenceViewFactory()
    this.renderer = options.renderer || new Renderer()
  }

  createWriter(stream: Writable, traceId = randomUUID()) {
    return new SSEWriter({
      stream,
      traceId,
      schemaVersion: SCHEMA_VERSION,
    })
  }

  async handle(request: ChatRequestV4, writer: SSEWriter) {
    const startedAt = Date.now()
    const traceId = writer.traceId
    const requestId = request.options?.requestId || traceId
    const sessionId = request.options?.sessionId
    const skill = this.requirePostgisSkill()
    const logger = createLogger().child({
      traceId,
      requestId,
      sessionId: sessionId || null,
    })

    await writer.trace({
      request_id: requestId,
      version: this.options.version,
    })
    await writer.job({
      mode: 'deterministic_single_turn',
      version: this.options.version,
    })
    await writer.stage('intent')
    await writer.thinking({
      status: 'start',
      message: '正在识别问题类型与锚点...',
    })

    const intent = this.router.route(request)
    await writer.intentPreview({
      rawAnchor: intent.placeName,
      normalizedAnchor: intent.placeName,
      displayAnchor: intent.placeName,
      targetCategory: intent.targetCategory,
      confidence: intent.queryType === 'unsupported' ? 0.45 : 0.95,
      needsClarification: intent.needsClarification,
      clarificationHint: intent.clarificationHint,
      parserModel: 'deterministic-router',
      parserProvider: 'rule',
    })

    if (intent.queryType === 'unsupported') {
      await this.respondWithoutExecution({
        writer,
        intent,
        answer: this.buildUnsupportedAnswer(),
        stats: this.buildStats({
          traceId,
          intent,
          startedAt,
          anchor: null,
          resultCount: 0,
        }),
        startedAt,
      })
      return
    }

    if (intent.needsClarification || !intent.placeName) {
      await this.respondWithoutExecution({
        writer,
        intent,
        answer: intent.clarificationHint || '请告诉我一个明确地点后再继续。',
        stats: this.buildStats({
          traceId,
          intent,
          startedAt,
          anchor: null,
          resultCount: 0,
        }),
        startedAt,
      })
      return
    }

    const context = createSkillExecutionContext({
      traceId,
      requestId,
      sessionId,
      logger,
    })

    const anchorResult = await skill.execute(
      'resolve_anchor',
      {
        place_name: intent.placeName,
        role: 'primary',
      },
      context,
    )

    const anchor = anchorResult.data?.anchor || null
    if (!anchor || anchor.source === 'unresolved' || !hasAnchorCoordinates(anchor)) {
      const unresolvedIntent: DeterministicIntent = {
        ...intent,
        needsClarification: true,
        clarificationHint: `我暂时没有定位到“${intent.placeName}”。请换成更明确的学校、商圈、地标或站点名称。`,
      }
      await writer.intentPreview({
        rawAnchor: intent.placeName,
        normalizedAnchor: intent.placeName,
        displayAnchor: intent.placeName,
        targetCategory: intent.targetCategory,
        confidence: 0.3,
        needsClarification: true,
        clarificationHint: unresolvedIntent.clarificationHint,
        parserModel: 'deterministic-router',
        parserProvider: 'rule',
      })
      await this.respondWithoutExecution({
        writer,
        intent: unresolvedIntent,
        answer: unresolvedIntent.clarificationHint || '请换一个更明确的地点名称。',
        stats: this.buildStats({
          traceId,
          intent: unresolvedIntent,
          startedAt,
          anchor: null,
          resultCount: 0,
        }),
        startedAt,
      })
      return
    }

    await writer.stage('query')
    await writer.thinking({
      status: 'start',
      message: `已定位 ${anchor.resolved_place_name}，正在执行模板查询...`,
    })

    const sql = this.buildTemplateSQL(intent, anchor)
    await this.ensureValidSQL(skill, sql, context)
    const execution = await this.executeSQL(skill, sql, context)
    const rows = Array.isArray(execution.rows) ? execution.rows : []
    const evidenceView = this.evidenceFactory.create({
      intent,
      anchor,
      rows,
    })
    const answer = this.renderer.render(evidenceView)
    const pois = normalizePoiRows(rows)
    const stats = this.buildStats({
      traceId,
      intent,
      startedAt,
      anchor,
      resultCount: rows.length,
      targetCategory: intent.targetCategory,
    })

    await writer.pois(pois)
    await writer.stage('answer')
    await writer.thinking({
      status: 'end',
      message: '查询完成，正在组织结果...',
    })
    await writer.stats(stats)
    await writer.refinedResult(this.buildRefinedResult({
      traceId,
      intent,
      answer,
      pois,
      stats,
    }))
    await writer.done({
      duration_ms: Date.now() - startedAt,
    })
  }

  private async respondWithoutExecution(input: {
    writer: SSEWriter
    intent: DeterministicIntent
    answer: string
    stats: Record<string, unknown>
    startedAt: number
  }) {
    await input.writer.stage('answer')
    await input.writer.thinking({
      status: 'end',
      message: '当前问题需要补充信息后才能继续。',
    })
    await input.writer.stats(input.stats)
    await input.writer.refinedResult(this.buildRefinedResult({
      traceId: input.writer.traceId,
      intent: input.intent,
      answer: input.answer,
      pois: [],
      stats: input.stats,
    }))
    await input.writer.done({
      duration_ms: Date.now() - input.startedAt,
    })
  }

  private requirePostgisSkill() {
    const skill = this.options.registry.get('postgis')
    if (!skill) {
      throw new Error('postgis skill is not registered')
    }
    return skill
  }

  private async ensureValidSQL(skill: SkillDefinition, sql: string, context: ReturnType<typeof createSkillExecutionContext>) {
    const validation = await skill.execute(
      'validate_spatial_sql',
      { sql },
      context,
    )

    if (!validation.ok || validation.data?.valid !== true) {
      throw new Error(validation.error?.message || 'Generated SQL failed validation')
    }
  }

  private async executeSQL(
    skill: SkillDefinition,
    sql: string,
    context: ReturnType<typeof createSkillExecutionContext>,
  ) {
    const execution = await skill.execute(
      'execute_spatial_sql',
      { sql },
      context,
    )

    if (!execution.ok || !execution.data) {
      throw new Error(execution.error?.message || 'SQL execution failed')
    }

    return execution.data
  }

  private buildTemplateSQL(intent: DeterministicIntent, anchor: ResolvedAnchor) {
    const point = `ST_SetSRID(ST_MakePoint(${formatNumericLiteral(anchor.lon)}, ${formatNumericLiteral(anchor.lat)}), 4326)::geography`
    const baseSelect = [
      'SELECT id, name, category_main, category_sub, longitude, latitude,',
      `  ST_Distance(geom::geography, ${point}) AS distance_m`,
      'FROM pois',
      `WHERE ST_DWithin(geom::geography, ${point}, ${intent.queryType === 'nearest_station' ? 3000 : intent.radiusM})`,
    ]

    const filters: string[] = []

    if (intent.queryType === 'nearest_station') {
      filters.push(`AND category_main = '交通设施服务'`)
      filters.push(`AND category_sub = '地铁站'`)
      return [
        ...baseSelect,
        ...filters,
        'ORDER BY distance_m ASC',
        'LIMIT 1',
      ].join('\n')
    }

    switch (intent.categoryKey) {
      case 'coffee':
        filters.push(`AND category_main = '餐饮美食'`)
        filters.push(`AND category_sub = '咖啡'`)
        break
      case 'supermarket':
        filters.push(`AND category_main = '购物服务'`)
        filters.push(`AND category_sub IN ('超级市场', '便民商店/便利店', '购物相关场所')`)
        break
      case 'metro_station':
        filters.push(`AND category_main = '交通设施服务'`)
        filters.push(`AND category_sub = '地铁站'`)
        break
      default:
        break
    }

    return [
      ...baseSelect,
      ...filters,
      'ORDER BY distance_m ASC',
      'LIMIT 10',
    ].join('\n')
  }

  private buildRefinedResult(input: {
    traceId: string
    intent: DeterministicIntent
    answer: string
    pois: EvidenceItem[]
    stats: Record<string, unknown>
  }): Record<string, unknown> {
    return {
      answer: input.answer,
      results: {
        pois: input.pois,
        stats: input.stats,
        intentMeta: {
          queryType: input.intent.queryType,
          intentMode: input.intent.intentMode,
          queryPlan: {
            query_type: input.intent.queryType,
            intent_mode: input.intent.intentMode,
          },
          placeName: input.intent.placeName,
          targetCategory: input.intent.targetCategory,
        },
      },
      intent: {
        queryType: input.intent.queryType,
        intentMode: input.intent.intentMode,
        placeName: input.intent.placeName,
        targetCategory: input.intent.targetCategory,
      },
      trace_id: input.traceId,
    }
  }

  private buildStats(input: {
    traceId: string
    intent: DeterministicIntent
    startedAt: number
    anchor: ResolvedAnchor | null
    resultCount: number
    targetCategory?: string | null
  }) {
    return {
      query_type: input.intent.queryType,
      intent_mode: input.intent.intentMode,
      result_count: input.resultCount,
      anchor_name: input.anchor?.resolved_place_name || input.intent.placeName || null,
      anchor_lon: input.anchor?.lon ?? null,
      anchor_lat: input.anchor?.lat ?? null,
      radius_m: input.intent.radiusM,
      target_category: input.targetCategory || input.intent.targetCategory || null,
      latency_ms: Date.now() - input.startedAt,
      version: this.options.version,
      trace_id: input.traceId,
    }
  }

  private buildUnsupportedAnswer() {
    return '当前 V4 只支持两类确定性问题：某地附近有什么，以及某地最近的地铁站是什么。你可以试试“武汉大学附近有哪些咖啡店？”或“武汉大学最近的地铁站是什么？”。'
  }
}
