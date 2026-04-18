import { describe, expect, it } from 'vitest'

import {
  buildNarrativeViewportSummary,
  buildNarrativeSteps,
  buildNarrativeTransitions,
  rankNarrativeNodes,
  resolveNodeRoleFromPoi,
  resolveRoleLabel,
} from '../../../src/narrative/planner.js'
import type { EvidenceItem, RegionFeatureTag } from '../../../src/chat/types.js'
import type { NarrativeNode, NarrativeViewportSummary } from '../../../src/narrative/types.js'

function makeSummary(sceneMix: string[] = ['高校', '商业休闲']): NarrativeViewportSummary {
  return {
    dominantScene: sceneMix[0] || '高校',
    sceneMix,
    summarySentence: '测试视口',
    featureTags: [] as RegionFeatureTag[],
    sceneTags: sceneMix,
    dominantBuckets: [],
    encoderSummary: null,
    encoderTags: [],
    requestedStyle: 'classic_must_see',
    requestedStyleLabel: '快速了解',
  }
}

function makeNode(partial: Partial<NarrativeNode> & { id: string, name: string, role: string, score: number }): NarrativeNode {
  return {
    id: partial.id,
    name: partial.name,
    role: partial.role,
    roleLabel: partial.roleLabel || resolveRoleLabel(partial.role),
    source: partial.source || 'aoi_context',
    center: partial.center || { lon: 114.35, lat: 30.55 },
    score: partial.score,
    categoryMain: partial.categoryMain ?? null,
    categorySub: partial.categorySub ?? null,
    distanceM: partial.distanceM ?? null,
    tags: partial.tags || [partial.role],
    reasons: partial.reasons || [resolveRoleLabel(partial.role)],
    hotness: partial.hotness || 'low',
    childPoiIds: partial.childPoiIds,
    encoderSummary: partial.encoderSummary ?? null,
    encoderTags: partial.encoderTags || [],
  }
}

describe('planner narrative eligibility hard gates', () => {
  it('医学院名称的 POI 应判成 medical_anchor', () => {
    const role = resolveNodeRoleFromPoi({
      id: 'poi:whu-med',
      name: '武汉大学医学院',
      longitude: 114.36,
      latitude: 30.54,
      categoryMain: '科教文化服务',
      categorySub: '高等院校',
    } as unknown as EvidenceItem)

    expect(role).toBe('medical_anchor')
  })

  it('老年大学应判为文化类辅助节点，而不是校园主锚点', () => {
    const role = resolveNodeRoleFromPoi({
      id: 'poi:hubei-senior',
      name: '湖北省老年大学',
      longitude: 114.31,
      latitude: 30.56,
      categoryMain: '科教文化服务',
      categorySub: '学校',
    } as unknown as EvidenceItem)

    expect(role).toBe('culture_anchor')
  })

  it('神学院应判为宗教类节点，而不是高校锚点', () => {
    const role = resolveNodeRoleFromPoi({
      id: 'poi:seminary',
      name: '中南神学院',
      longitude: 114.32,
      latitude: 30.53,
      categoryMain: '科教文化服务',
      categorySub: '高等院校',
    } as unknown as EvidenceItem)

    expect(role).toBe('religious_anchor')
  })

  it('district_anchor 的展示标签不应再出现片区节点', () => {
    expect(resolveRoleLabel('district_anchor')).toBe('区域代表')
  })

  it('小区和管理服务中心不应通过 fallback 池混入 narrative', () => {
    const summary = makeSummary()
    const result = rankNarrativeNodes([
      makeNode({
        id: 'campus:valid',
        name: '武汉大学',
        role: 'campus_anchor',
        score: 0.92,
        childPoiIds: ['poi:1', 'poi:2'],
        tags: ['campus_anchor', 'aoi_support'],
      }),
      makeNode({
        id: 'campus:residential',
        name: '武汉理工大学友谊小区',
        role: 'campus_anchor',
        score: 0.95,
        childPoiIds: ['poi:3', 'poi:4'],
        tags: ['campus_anchor'],
      }),
      makeNode({
        id: 'commercial:support',
        name: '武汉轨道交通线网管理服务中心',
        role: 'commercial_anchor',
        score: 0.97,
        tags: ['commercial_anchor'],
        encoderSummary: '商业休闲节点',
      }),
      makeNode({
        id: 'scenic:valid',
        name: '沙湖公园',
        role: 'scenic_landmark',
        score: 0.94,
        tags: ['scenic_landmark', 'aoi_support'],
      }),
    ], summary, 10)

    const names = result.selectedNodes.map((node) => node.name)
    expect(names).toContain('武汉大学')
    expect(names).toContain('沙湖公园')
    expect(names).not.toContain('武汉理工大学友谊小区')
    expect(names).not.toContain('武汉轨道交通线网管理服务中心')
  })

  it('景观同义节点不应重复入选，商业综合体和地铁站可作为补充节点保留', () => {
    const summary = makeSummary(['景观地标', '商业休闲', '交通接驳'])
    const result = rankNarrativeNodes([
      makeNode({
        id: 'scenic:lake',
        name: '沙湖',
        role: 'scenic_landmark',
        score: 0.97,
        center: { lon: 114.335, lat: 30.585 },
        categorySub: 'water',
        tags: ['scenic_landmark', 'aoi_support'],
      }),
      makeNode({
        id: 'scenic:park',
        name: '沙湖公园',
        role: 'scenic_landmark',
        score: 0.95,
        center: { lon: 114.337, lat: 30.584 },
        categorySub: '景区/公园',
        tags: ['scenic_landmark', 'aoi_support'],
      }),
      makeNode({
        id: 'commercial:optics',
        name: '光谷商圈',
        role: 'commercial_anchor',
        score: 0.91,
        center: { lon: 114.41, lat: 30.51 },
        categorySub: '商业街区',
        childPoiIds: ['poi:10', 'poi:11', 'poi:12'],
        tags: ['commercial_anchor', 'aoi_support'],
      }),
      makeNode({
        id: 'commercial:mixc',
        name: '武昌万象城',
        role: 'commercial_anchor',
        score: 0.9,
        center: { lon: 114.346, lat: 30.568 },
        categorySub: '商业街区',
        childPoiIds: ['poi:13', 'poi:14'],
        tags: ['commercial_anchor', 'aoi_support'],
      }),
      makeNode({
        id: 'transit:hanjie',
        name: '楚河汉街地铁站',
        role: 'transit_connector',
        score: 0.79,
        center: { lon: 114.341, lat: 30.565 },
        categorySub: '地铁站',
        encoderSummary: '商业休闲与交通换乘交汇节点',
        tags: ['transit_connector'],
      }),
    ], summary, 10)

    const names = result.selectedNodes.map((node) => node.name)
    expect(names.filter((name) => name === '沙湖' || name === '沙湖公园')).toHaveLength(1)
    expect(names).toContain('光谷商圈')
    expect(names).toContain('武昌万象城')
    expect(names).toContain('楚河汉街地铁站')
  })

  it('医学部与主校名冲突时，应优先保留更具体的医学节点', () => {
    const summary = makeSummary(['高校', '商业休闲'])
    const result = rankNarrativeNodes([
      makeNode({
        id: 'campus:whu',
        name: '武汉大学',
        role: 'campus_anchor',
        score: 0.95,
        center: { lon: 114.365, lat: 30.538 },
        tags: ['campus_anchor', 'aoi_support'],
      }),
      makeNode({
        id: 'medical:whu-med',
        name: '武汉大学医学部',
        role: 'medical_anchor',
        score: 0.89,
        center: { lon: 114.366, lat: 30.539 },
        tags: ['medical_anchor', 'aoi_support'],
      }),
      makeNode({
        id: 'commercial:mixc',
        name: '武昌万象城',
        role: 'commercial_anchor',
        score: 0.9,
        center: { lon: 114.346, lat: 30.568 },
        childPoiIds: ['poi:13', 'poi:14'],
        tags: ['commercial_anchor', 'aoi_support'],
      }),
    ], summary, 10)

    const names = result.selectedNodes.map((node) => node.name)
    expect(names).toContain('武汉大学医学部')
  })

  it('导览步骤应包含层级、理由卡和本地人提醒', () => {
    const summary = makeSummary(['商业休闲', '交通接驳'])
    summary.requestedStyle = 'local_vibe'
    summary.requestedStyleLabel = '本地人版本'
    const nodes = rankNarrativeNodes([
      makeNode({
        id: 'transit:station',
        name: '楚河汉街地铁站',
        role: 'transit_connector',
        score: 0.88,
        center: { lon: 114.341, lat: 30.565 },
        tags: ['transit_connector'],
      }),
      makeNode({
        id: 'commercial:mixc',
        name: '武昌万象城',
        role: 'commercial_anchor',
        score: 0.9,
        center: { lon: 114.346, lat: 30.568 },
        childPoiIds: ['poi:13', 'poi:14'],
        tags: ['commercial_anchor', 'aoi_support'],
      }),
    ], summary, 10).selectedNodes

    const transitions = buildNarrativeTransitions(nodes)
    const steps = buildNarrativeSteps({ summary, nodes, transitions })
    const nodeStep = steps.find((step) => step.focus === '楚河汉街地铁站')

    expect(nodeStep?.tierLabel).toBe('入口节点')
    expect(nodeStep?.reasonCard?.represents).toContain('入口')
    expect(nodeStep?.localTip).toContain('我')
    expect(nodeStep?.localTip).toContain('第一站')
    expect(nodeStep?.tourStyleLabel).toBe('本地人版本')
  })

  it('快速了解视角的总览摘要不应暴露编码器黑盒措辞', () => {
    const summary = buildNarrativeViewportSummary({
      featureTags: [] as RegionFeatureTag[],
      featureSummary: '编码器提取的片区特征包括：校园主导、商业休闲、交通接驳。',
      encoderSummary: '编码器提取的片区特征包括：居住支撑、AOI 场景：运动休闲、片区主导品类：商务住宅。',
      candidates: [
        makeNode({
          id: 'campus:whu-med',
          name: '武汉大学医学部',
          role: 'medical_anchor',
          score: 0.92,
          tags: ['medical_anchor', 'aoi_support'],
        }),
        makeNode({
          id: 'commercial:mixc',
          name: '武昌万象城',
          role: 'commercial_anchor',
          score: 0.89,
          tags: ['commercial_anchor', 'aoi_support'],
        }),
      ],
      requestedStyle: 'classic_must_see',
    })

    expect(summary.requestedStyleLabel).toBe('快速了解')
    expect(summary.summarySentence).not.toContain('编码器')
    expect(summary.summarySentence).not.toContain('AOI')
    expect(summary.summarySentence).toContain('快速了解')
  })
})
