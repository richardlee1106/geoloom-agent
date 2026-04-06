import {
  buildAiBoundaryMeta,
  buildBoundaryPopupLines,
  confidenceBucket,
  formatLegendPercent,
  nicheLabel,
  toFiniteBoundaryConfidence
} from '../aiBoundaryMeta'

describe('aiBoundaryMeta utils', () => {
  it('normalizes confidence and bucket helpers', () => {
    expect(toFiniteBoundaryConfidence(-0.1)).toBe(0)
    expect(toFiniteBoundaryConfidence(1.8)).toBe(1)
    expect(toFiniteBoundaryConfidence('0.42')).toBe(0.42)
    expect(toFiniteBoundaryConfidence('abc')).toBeNull()

    expect(confidenceBucket(0.8)).toBe('high')
    expect(confidenceBucket(0.5)).toBe('medium')
    expect(confidenceBucket(0.2)).toBe('low')
    expect(confidenceBucket(null)).toBe('unknown')

    expect(formatLegendPercent(0.426)).toBe('43%')
    expect(formatLegendPercent(null)).toBe('--')
    expect(nicheLabel('education')).toBe('科教')
  })

  it('builds semantic meta from snake_case and camelCase payloads', () => {
    const meta = buildAiBoundaryMeta(
      {
        semantic_anchor: { name: '沙湖公园' },
        nicheProfile: { nicheType: 'ecology', confidence: 0.82 },
        boundary_confidence: 0.74,
        confidence_explain: { model: 'composite_v3' },
        boundary_quality: { water_penalty: 0.12, water_overlap_ratio: 0.18 },
        semanticReasoning: { evidence: [{ type: 'anchor' }, { type: 'water_context' }] },
        landuse_semantic: { top_labels: [{ label: '水域' }, { label: '公园绿地' }] }
      },
      { fuzzyLayer: 'core' }
    )

    expect(meta).toMatchObject({
      fuzzyLayer: 'core',
      anchorName: '沙湖公园',
      nicheType: 'ecology',
      nicheConfidence: 0.82,
      boundaryConfidence: 0.74,
      confidenceModel: 'composite_v3',
      waterPenalty: 0.12,
      waterOverlapRatio: 0.18,
      topLanduseLabels: ['水域', '公园绿地']
    })
    expect(meta.reasonTypes).toEqual(['anchor', 'water_context'])
  })

  it('builds popup lines with semantic evidence and keeps max 4 lines', () => {
    const lines = buildBoundaryPopupLines({
      anchorName: '沙湖',
      nicheType: 'ecology',
      nicheConfidence: 0.82,
      boundaryConfidence: 0.74,
      confidenceModel: 'composite_v3',
      waterPenalty: 0.12,
      topLanduseLabels: ['水域', '公园绿地'],
      reasonTypes: ['anchor', 'landuse', 'water_context']
    })

    expect(lines).toHaveLength(4)
    expect(lines[0]).toBe('锚点 沙湖')
    expect(lines[1]).toBe('生态位 生态 82%')
    expect(lines[2]).toBe('边界可信 74% / composite_v3')
    expect(lines[3]).toBe('水域惩罚 12%')

    const reasonLines = buildBoundaryPopupLines({
      anchorName: '销品茂',
      nicheType: 'commerce',
      boundaryConfidence: 0.68,
      reasonTypes: ['anchor', 'landuse']
    })
    expect(reasonLines).toContain('约束 关键词 / 用地')
  })
  it('adds encoder involvement lines when encoder stats are available', () => {
    const lines = buildBoundaryPopupLines({
      boundaryConfidence: 0.79,
      confidenceModel: 'v3_l5_geometry_v1',
      encoderPredictedCount: 12,
      encoderHighConfidenceCount: 10,
      vectorConstraintSource: 'road_blocks'
    })

    expect(lines.some((line) => line.includes('编码器'))).toBe(true)
    expect(lines.some((line) => line.includes('road_blocks'))).toBe(true)
  })
})
