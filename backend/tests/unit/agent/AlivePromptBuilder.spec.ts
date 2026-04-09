import { describe, expect, it } from 'vitest'

import { AlivePromptBuilder } from '../../../src/agent/AlivePromptBuilder.js'

describe('AlivePromptBuilder', () => {
  it('combines profiles, memory snapshot and skill prompt snippets into one prompt', () => {
    const builder = new AlivePromptBuilder()

    const prompt = builder.build({
      sessionId: 'sess_phase3_alive',
      profiles: {
        soul: '你是一个谨慎、证据驱动的空间助手。',
        user: '用户偏好简洁回答，但要明确说明证据来源。',
      },
      memory: {
        summary: '上轮已经定位过武汉大学，最近在问咖啡和地铁。',
        recentTurns: [
          {
            traceId: 'trace_alive_001',
            userQuery: '武汉大学附近有哪些咖啡店？',
            answer: '找到 5 家咖啡店。',
            createdAt: '2026-04-02T00:00:00.000Z',
          },
        ],
      },
      skillSnippets: [
        'postgis: 只读空间事实技能，可解析锚点并执行受限 SQL。',
        'route_distance: 可估算步行距离并返回降级标记。',
      ],
    })

    expect(prompt).toContain('sess_phase3_alive')
    expect(prompt).toContain('谨慎、证据驱动')
    expect(prompt).toContain('上轮已经定位过武汉大学')
    expect(prompt).toContain('postgis')
    expect(prompt).toContain('route_distance')
  })

  it('teaches the model to orchestrate area insight questions with evidence-first tool sequencing', () => {
    const builder = new AlivePromptBuilder()

    const prompt = builder.build({
      sessionId: 'sess_area_insight',
      profiles: {
        soul: '你是一个谨慎、证据驱动的空间助手。',
        user: '用户希望你像真正的 agent 一样调用工具后再回答。',
      },
      memory: {
        summary: '用户最近在问当前区域值不值得开店，以及主导业态和热点。',
        recentTurns: [],
      },
      skillSnippets: [
        'postgis: area insight 优先拿结构证据。',
        'spatial_vector: 只提供候选和相似片区辅助。',
      ],
    })

    expect(prompt).toContain('模型负责思考和编排')
    expect(prompt).toContain('先拿结构证据')
    expect(prompt).toContain('语义辅助证据')
    expect(prompt).toContain('主导业态')
    expect(prompt).toContain('机会')
  })

  it('teaches the model to treat AOI and landuse as optional enhancement evidence instead of primary structural proof', () => {
    const builder = new AlivePromptBuilder()

    const prompt = builder.build({
      sessionId: 'sess_area_semantic_context',
      profiles: {
        soul: '你是一个谨慎、证据驱动的空间助手。',
        user: '用户希望你解释片区语义，但不要乱猜。',
      },
      memory: {
        summary: '用户最近在追问某片区到底更像居住区还是商业区。',
        recentTurns: [],
      },
      skillSnippets: [
        'postgis: 可补 AOI 和 landuse 作为片区语义增强证据。',
      ],
    })

    expect(prompt).toContain('AOI')
    expect(prompt).toContain('landuse')
    expect(prompt).toContain('片区命名')
    expect(prompt).toContain('语义校正')
    expect(prompt).toContain('增强证据')
    expect(prompt).toContain('不替代主结构证据')
  })

  it('teaches the model to distinguish summary, store-opportunity and semantic-classification area tasks', () => {
    const builder = new AlivePromptBuilder()

    const prompt = builder.build({
      sessionId: 'sess_area_playbook',
      profiles: {
        soul: '你是一个谨慎、证据驱动的空间助手。',
        user: '用户希望片区总结和开店判断不要答成同一套模板。',
      },
      memory: {
        summary: '用户最近同时在问片区总结、开什么店和片区语义判断。',
        recentTurns: [],
      },
      skillSnippets: [
        'postgis: 先拿结构、热点、竞争和样本，再按需补 AOI / landuse。',
      ],
    })

    expect(prompt).toContain('片区总结')
    expect(prompt).toContain('开店')
    expect(prompt).toContain('供给')
    expect(prompt).toContain('竞争')
    expect(prompt).toContain('AOI')
    expect(prompt).toContain('不要把“开店判断”答成“片区总结”的改写版')
  })

  it('teaches the model to distinguish query and analysis as two normal LLM-led paths instead of fallback modes', () => {
    const builder = new AlivePromptBuilder()

    const prompt = builder.build({
      sessionId: 'sess_query_vs_analysis',
      profiles: {
        soul: '你是一个谨慎、证据驱动的空间助手。',
        user: '用户希望知道当前回答到底是不是模型自己在编排。',
      },
      memory: {
        summary: '用户明确要求去掉固定模板和内容级 fallback。',
        recentTurns: [],
      },
      skillSnippets: [
        'postgis: 提供空间事实和结构统计。',
      ],
    })

    expect(prompt).toContain('查询型任务')
    expect(prompt).toContain('分析型任务')
    expect(prompt).toContain('查询型任务也属于正常主链路')
    expect(prompt).toContain('不是 fallback')
    expect(prompt).toContain('先自己判断当前问题更像查询还是分析')
  })
})
