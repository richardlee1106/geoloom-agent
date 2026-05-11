import { describe, expect, it, vi } from 'vitest'

import type { LLMProvider, LLMResponse } from '../../../src/llm/types.js'
import type { NarrativeChapter, NarrativePoi } from '../../../src/narrative/contract.js'
import { polygonFromBounds } from '../../../src/narrative/geometry.js'
import { buildGraphNarrationChapter, LlmNarratorError, resolveLlmNarratorPromptVariant } from '../../../src/narrative/llmNarrator.js'
import type { PathSamplerResult } from '../../../src/narrative/pathSampler.js'
import type { RegionCandidate } from '../../../src/narrative/regionCandidate.js'

function createProvider(content: string): LLMProvider {
  return {
    getStatus: () => ({ ready: true, provider: 'test-provider', model: 'deepseek-v4-flash-search-nothinking', target: 'mock://llm' }),
    isReady: () => true,
    complete: vi.fn(async () => ({
      assistantMessage: { role: 'assistant', content, toolCalls: [] },
      toolCalls: [],
      finishReason: 'stop',
    } satisfies LLMResponse)),
  }
}

function unreadyProvider(): LLMProvider {
  return {
    getStatus: () => ({ ready: false, provider: 'test-provider', model: '', target: 'mock://llm' }),
    isReady: () => false,
    complete: vi.fn(async () => { throw new Error('should not be called') }),
  }
}

function candidate(id: string, name: string, categoryMain: string): RegionCandidate {
  const poi: NarrativePoi = {
    id: `poi-${id}`,
    lon: 114.34,
    lat: 30.54,
    display_name: `${name}支撑点`,
    tier: 'strong',
    role: 'scene_evidence',
    category_main: categoryMain,
    story_tags: categoryMain === '风景名胜' ? ['ecology'] : categoryMain === '科教文化服务' ? ['education'] : ['urban_life'],
  }
  return {
    id,
    display_name: name,
    role: 'primary_region',
    core_anchor: { id, lon: 114.34, lat: 30.54 },
    boundary: polygonFromBounds({ west: 114.33, south: 30.53, east: 114.35, north: 30.55 }),
    visual_layer: { mode: 'region_glow' },
    pois: [poi],
    business_profile: {
      sample_size: 3,
      dominant_main_types: [{ name: categoryMain, count: 3, share: 1, examples: [`${name}支撑点`] }],
      dominant_sub_types: [{ name: categoryMain === '风景名胜' ? '公园广场' : '文化场馆', count: 2, share: 0.667 }],
      representative_places: [`${name}支撑点`],
      summary_hint: categoryMain === '风景名胜' ? '公园广场更集中，休闲停留和慢慢逛的属性更明显。' : '文化场馆更集中，学习、文化和日常停留的线索更明显。',
      confidence: 'medium',
    },
    narrative_facts: [
      {
        claim: `${name}拥有可解释的真实地界。`,
        source: 'aoi_entity',
        confidence: 0.92,
        verified: true,
        related_entity: { type: 'region', id },
      },
    ],
    story_tags: poi.story_tags,
    score: 0.9,
    source: 'aoi',
    coverage: 0.7,
    diversity: 0.4,
    effectivePoiCount: 1,
  }
}

const path: PathSamplerResult = {
  nodes: [
    { region_id: 'wuda', narration_role: 'core', transition_reason: '从当前视野中最有代表性的区域开始讲起。', story_tags: ['education'] },
    { region_id: 'east-lake', narration_role: 'ecological', transition_reason: '从武汉大学往东转到东湖风景区。', story_tags: ['ecology'] },
  ],
  alternativesCount: 0,
  engine: 'seeded_lod_bbox_sampler',
  strategy: 'campus_ecology_walk',
  storyTags: ['education', 'ecology'],
  lodPolicy: {
    lod: 'meso',
    max_nodes: 8,
    top_k: 4,
    beta: 8,
    distance_bias: 'balanced',
    continuity_bias: 'balanced',
    diversity_bias: 'mixed_cluster',
  },
  relations: [
    {
      from_region_id: 'wuda',
      to_region_id: 'east-lake',
      type: 'functional_complement',
      strength: 0.82,
      evidence: ['教育文化→生态休闲'],
      shared_story_tags: [],
    },
  ],
}

const scaffolds: NarrativeChapter[] = [
  { region_id: 'wuda', text: '', length_ms: 9000, story_tags: ['education'] },
  { region_id: 'east-lake', text: '', length_ms: 9000, story_tags: ['ecology'] },
]

const regions = [candidate('wuda', '武汉大学', '科教文化服务'), candidate('east-lake', '东湖风景区', '风景名胜')]
const userContext = { time_label: '下午', weather_label: '晴', preference_label: '游览', history_label: '首次进入' }

describe('buildGraphNarrationChapter', () => {
  it('成功时返回带 LLM 生成文本的章节，无 fallback 痕迹', async () => {
    const provider = createProvider(JSON.stringify({
      region_id: 'wuda',
      text: '先看武汉大学，校园文化和周边书店、咖啡馆连成一条慢节奏散步路线，本地学生下课会顺着这边走到湖边吹风。',
    }))

    const result = await buildGraphNarrationChapter({
      chapter: scaffolds[0],
      allChapters: scaffolds,
      regions,
      path,
      scene: 'education_culture',
      tone: 'tour',
      userContext,
      llmProvider: provider,
    })

    expect(result.debug.used).toBe(true)
    expect(result.debug.error).toBeUndefined()
    expect(result.chapter.region_id).toBe('wuda')
    expect(result.chapter.text).toContain('武汉大学')
    expect(result.chapter.text.length).toBeGreaterThan(20)
    expect(result.chapter.generation_error).toBeUndefined()
  })

  it('支持纯文本输出（非 JSON），直接作为 chapter.text', async () => {
    const provider = createProvider('武汉大学这一段先把校园和周边文化氛围讲清楚，再顺着人流顺路往东边湖区移动。')

    const result = await buildGraphNarrationChapter({
      chapter: scaffolds[0],
      allChapters: scaffolds,
      regions,
      path,
      scene: 'education_culture',
      tone: 'tour',
      userContext,
      llmProvider: provider,
    })

    expect(result.chapter.text).toContain('武汉大学')
  })

  it('LLM disabled 时抛出 disabled 错误，绝不返回 fallback chapter', async () => {
    const provider = createProvider('whatever')

    await expect(buildGraphNarrationChapter({
      chapter: scaffolds[0],
      allChapters: scaffolds,
      regions,
      path,
      scene: 'education_culture',
      tone: 'tour',
      userContext,
      llmProvider: provider,
      enabled: false,
    })).rejects.toMatchObject({ name: 'LlmNarratorError', code: 'disabled' })
  })

  it('未注入 provider 时抛 no_provider', async () => {
    await expect(buildGraphNarrationChapter({
      chapter: scaffolds[0],
      allChapters: scaffolds,
      regions,
      path,
      scene: 'education_culture',
      tone: 'tour',
      userContext,
    })).rejects.toMatchObject({ name: 'LlmNarratorError', code: 'no_provider' })
  })

  it('provider 未就绪时抛 provider_not_ready', async () => {
    await expect(buildGraphNarrationChapter({
      chapter: scaffolds[0],
      allChapters: scaffolds,
      regions,
      path,
      scene: 'education_culture',
      tone: 'tour',
      userContext,
      llmProvider: unreadyProvider(),
    })).rejects.toMatchObject({ name: 'LlmNarratorError', code: 'provider_not_ready' })
  })

  it('LLM 输出过短时抛 too_short 而不是返回 fallback', async () => {
    const provider = createProvider(JSON.stringify({ region_id: 'wuda', text: '武汉大学。' }))

    await expect(buildGraphNarrationChapter({
      chapter: scaffolds[0],
      allChapters: scaffolds,
      regions,
      path,
      scene: 'education_culture',
      tone: 'tour',
      userContext,
      llmProvider: provider,
    })).rejects.toMatchObject({ name: 'LlmNarratorError', code: 'too_short' })
  })

  it('LLM 输出命中论文腔禁词时抛 forbidden_word', async () => {
    const provider = createProvider(JSON.stringify({
      region_id: 'wuda',
      text: '武汉大学承担当前路线的核心，放在空间上下文里解释这片区域的功能拼图与转场逻辑。',
    }))

    await expect(buildGraphNarrationChapter({
      chapter: scaffolds[0],
      allChapters: scaffolds,
      regions,
      path,
      scene: 'education_culture',
      tone: 'tour',
      userContext,
      llmProvider: provider,
    })).rejects.toMatchObject({ name: 'LlmNarratorError', code: 'forbidden_word' })
  })

  it('LLM 输出包含 URL 时抛 url_leak', async () => {
    const provider = createProvider(JSON.stringify({
      region_id: 'wuda',
      text: '武汉大学校园开放参观，详情见 https://example.com/wuhan-university 介绍页，是本地常逛去处。',
    }))

    await expect(buildGraphNarrationChapter({
      chapter: scaffolds[0],
      allChapters: scaffolds,
      regions,
      path,
      scene: 'education_culture',
      tone: 'tour',
      userContext,
      llmProvider: provider,
    })).rejects.toMatchObject({ name: 'LlmNarratorError', code: 'url_leak' })
  })

  it('LLM 返回空 JSON 时抛 missing_text', async () => {
    const provider = createProvider(JSON.stringify({ region_id: 'wuda' }))

    await expect(buildGraphNarrationChapter({
      chapter: scaffolds[0],
      allChapters: scaffolds,
      regions,
      path,
      scene: 'education_culture',
      tone: 'tour',
      userContext,
      llmProvider: provider,
    })).rejects.toMatchObject({ name: 'LlmNarratorError', code: 'missing_text' })
  })

  it('LLM 请求抛错时被包装成 LlmNarratorError(request_failed)', async () => {
    const provider: LLMProvider = {
      getStatus: () => ({ ready: true, provider: 'test', model: 'test', target: 'mock://llm' }),
      isReady: () => true,
      complete: vi.fn(async () => { throw new Error('connection refused') }),
    }

    await expect(buildGraphNarrationChapter({
      chapter: scaffolds[0],
      allChapters: scaffolds,
      regions,
      path,
      scene: 'education_culture',
      tone: 'tour',
      userContext,
      llmProvider: provider,
    })).rejects.toMatchObject({ name: 'LlmNarratorError', code: 'request_failed' })
  })

  it('prompt 单章上下文：携带 target_region、prev/next、关系、allowed_facts、web_sources', async () => {
    const provider = createProvider(JSON.stringify({
      region_id: 'east-lake',
      text: '东湖风景区紧挨着武汉大学，校园人流走过来就能直接接到湖边的开放空间，本地人傍晚常来吹风散步。',
    }))

    await buildGraphNarrationChapter({
      chapter: { ...scaffolds[1], web_sources: [{ title: '东湖介绍', url: 'http://x', snippet: '东湖是武汉市内最大的城中湖。[2](http://example.com/source)', quality: 'encyclopedia' }] },
      allChapters: scaffolds,
      regions,
      path,
      scene: 'education_culture',
      tone: 'tour',
      userContext,
      llmProvider: provider,
    })

    const request = vi.mocked(provider.complete).mock.calls[0][0]
    const userPrompt = request.messages.find((message) => message.role === 'user')?.content || '{}'
    const payload = JSON.parse(userPrompt) as {
      target_region_id: string
      is_first_chapter: boolean
      target_region: { display_name: string }
      previous_region: { display_name: string } | null
      next_region: { display_name: string } | null
      relation_from_previous: { type: string } | null
      allowed_facts: string[]
      business_profile: { summary_hint: string; confidence: string } | null
      web_sources: Array<{ snippet: string }>
    }

    expect(payload.target_region_id).toBe('east-lake')
    expect(payload.is_first_chapter).toBe(false)
    expect(payload.target_region.display_name).toBe('东湖风景区')
    expect(payload.previous_region?.display_name).toBe('武汉大学')
    expect(payload.next_region).toBeNull()
    expect(payload.relation_from_previous?.type).toBe('functional_complement')
    expect(payload.allowed_facts.length).toBeGreaterThan(0)
    expect(payload.business_profile?.summary_hint).toContain('公园广场')
    expect(payload.web_sources[0].snippet).toContain('东湖')
    expect(payload.web_sources[0].snippet).not.toContain('http')
    expect(payload.web_sources[0].snippet).not.toContain('[2]')
  })

  it('system prompt 强调把组织权交给 LLM，不再硬塞四段式骨架或调度词清单', async () => {
    const provider = createProvider(JSON.stringify({
      region_id: 'wuda',
      text: '武汉大学这一段，校园文化和周边书店、咖啡馆连成一条慢节奏散步路线，本地学生下课会顺着这边走到湖边吹风。',
    }))

    await buildGraphNarrationChapter({
      chapter: scaffolds[0],
      allChapters: scaffolds,
      regions,
      path,
      scene: 'education_culture',
      tone: 'tour',
      userContext,
      llmProvider: provider,
    })

    const request = vi.mocked(provider.complete).mock.calls[0][0]
    const systemPrompt = request.messages.find((message) => message.role === 'system')?.content || ''

    expect(systemPrompt).toContain('土生土长的武汉本地朋友')
    expect(systemPrompt).toContain('怎么组织这一段由你自己决定')
    expect(systemPrompt).not.toContain('空间上下文')
    expect(systemPrompt).not.toContain('chapter_rules')
    expect(systemPrompt).not.toContain('narration_control')
  })

  it('lite prompt 使用精简事实包，不下发路线调度字段', async () => {
    const provider = createProvider(JSON.stringify({
      region_id: 'wuda',
      text: '武汉大学这一段，校园和周边生活连得很近，学生下课顺着树荫走到湖边吹风，路上书店和咖啡馆都很自然。',
    }))

    await buildGraphNarrationChapter({
      chapter: scaffolds[0],
      allChapters: scaffolds,
      regions,
      path,
      scene: 'education_culture',
      tone: 'tour',
      userContext,
      llmProvider: provider,
    })

    const request = vi.mocked(provider.complete).mock.calls[0][0]
    const systemPrompt = request.messages.find((message) => message.role === 'system')?.content || ''
    const userPrompt = request.messages.find((message) => message.role === 'user')?.content || '{}'
    const payload = JSON.parse(userPrompt) as Record<string, unknown>

    expect(systemPrompt).toContain('精简事实包')
    expect(systemPrompt).toContain('不要把普通公园、商场、校园写成攻略清单')
    expect(payload.narration_control).toBeUndefined()
    expect((payload.geograph as Array<Record<string, unknown>>)[0].chapter_control).toBeUndefined()
  })

  it('清单式或 Markdown 攻略输出会被拒绝', async () => {
    const provider = createProvider(JSON.stringify({
      region_id: 'wuda',
      text: '武汉大学这一段可以这么逛。1. **想活动活动**，先去操场；2. 想歇歇脚，再去湖边吹风。',
    }))

    await expect(buildGraphNarrationChapter({
      chapter: scaffolds[0],
      allChapters: scaffolds,
      regions,
      path,
      scene: 'education_culture',
      tone: 'tour',
      userContext,
      llmProvider: provider,
    })).rejects.toMatchObject({ code: 'template_listicle' })
  })

  it('resolveLlmNarratorPromptVariant 恒返回 lite', () => {
    expect(resolveLlmNarratorPromptVariant('auto')).toBe('lite')
    expect(resolveLlmNarratorPromptVariant()).toBe('lite')
    expect(resolveLlmNarratorPromptVariant('lite')).toBe('lite')
  })

  it('LlmNarratorError 的 code 字段可以被上游捕获用于细粒度错误处理', async () => {
    const provider = createProvider('not json at all')

    try {
      await buildGraphNarrationChapter({
        chapter: scaffolds[0],
        allChapters: scaffolds,
        regions,
        path,
        scene: 'education_culture',
        tone: 'tour',
        userContext,
        llmProvider: provider,
      })
      expect.fail('应当抛出 LlmNarratorError')
    } catch (error) {
      // 纯文本被作为 chapter.text 接收，但 'not json at all' 太短 → too_short
      expect(error).toBeInstanceOf(LlmNarratorError)
      expect((error as LlmNarratorError).code).toBe('too_short')
    }
  })
})
