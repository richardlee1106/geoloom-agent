import type { AreaInsightInput } from '../../chat/types.js'
import {
  mergeSemanticEvidenceStatuses,
  toSemanticEvidenceStatus,
  type SemanticEvidenceStatus,
} from '../../integration/dependencyStatus.js'
import {
  LocalPythonBridge,
  RemoteFirstPythonBridge,
  type PythonBridge,
} from '../../integration/pythonBridge.js'

export interface AreaSemanticDenoiseResult {
  rows: Record<string, unknown>[]
  areaInsight: AreaInsightInput
  semanticEvidence?: SemanticEvidenceStatus
  diagnostics: {
    applied: boolean
    keptCategories: string[]
    droppedCategories: string[]
    keptSamples: string[]
    droppedSamples: string[]
    threshold: number | null
    focusQuery?: string
  }
}

export interface AreaSemanticDenoiser {
  denoise(input: {
    rawQuery: string
    anchorName?: string | null
    areaInsight: AreaInsightInput
    fallbackRows?: Record<string, unknown>[]
  }): Promise<AreaSemanticDenoiseResult>
}

type EncodedText = {
  text: string
  vector: number[]
}

type ScoredCandidate<T> = {
  candidate: T
  score: number
}

type BucketCandidate = {
  label: string
  count: number
  sampleCount: number
  descriptor: string
  sourceRow: Record<string, unknown>
}

type SampleCandidate = {
  name: string
  categoryLabel: string
  descriptor: string
  sourceRow: Record<string, unknown>
}

function trimText(value: unknown) {
  return String(value || '').trim()
}

function normalizeKey(value: unknown) {
  return trimText(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '')
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const FOCUS_FILLER_PATTERNS = [
  /(请帮我看看|请帮我看下|请帮我看一下|帮我看看|帮我看下|帮我看一下|请帮我|帮我|麻烦你|麻烦|请|快速|直接|先)/gu,
  /(解读一下|解读|分析一下|分析|总结一下|总结|梳理一下|梳理|判断一下|判断|读懂一下|读懂|看看|看下|看一下|看一看|说明一下|说明|说说|介绍一下|介绍|讲讲)/gu,
  /一下/gu,
]

function normalizeFocusText(text: string, anchorName?: string | null) {
  let normalized = trimText(text)
  const anchor = trimText(anchorName)
  if (anchor) {
    normalized = normalized.replace(new RegExp(escapeRegExp(anchor), 'gu'), ' ')
  }

  normalized = normalized.replace(/(当前区域|当前片区|这片区域|这个区域|周边|附近|片区|区域)/gu, ' ')
  for (const pattern of FOCUS_FILLER_PATTERNS) {
    normalized = normalized.replace(pattern, ' ')
  }

  return normalized
    .replace(/[的地得]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
}

function readBucketLabel(row: Record<string, unknown>) {
  return trimText(row.category_main || row.categoryMain || row.label || row.competition_key || row.competitionKey)
}

function readSampleName(row: Record<string, unknown>) {
  return trimText(row.name) || '未命名地点'
}

function readSampleCategoryLabel(row: Record<string, unknown>) {
  return trimText(row.category_main || row.categoryMain || row.category_sub || row.categorySub || row.category)
}

function readSampleSubCategoryLabel(row: Record<string, unknown>) {
  return trimText(row.category_sub || row.categorySub || row.category)
}

function readCount(row: Record<string, unknown>) {
  const numeric = Number(row.poi_count || row.count || 0)
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 0
}

function cosineSimilarity(left: number[], right: number[]) {
  if (left.length === 0 || right.length === 0 || left.length !== right.length) {
    return 0
  }

  let dot = 0
  let leftNorm = 0
  let rightNorm = 0
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index]
    leftNorm += left[index] ** 2
    rightNorm += right[index] ** 2
  }

  if (leftNorm === 0 || rightNorm === 0) {
    return 0
  }

  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm))
}

function buildCharacterNgrams(text: string, size = 2) {
  const normalized = trimText(text)
    .toLowerCase()
    .replace(/\s+/gu, '')
  if (!normalized) {
    return new Set<string>()
  }

  const units = Array.from(normalized)
  if (units.length <= size) {
    return new Set([normalized])
  }

  const grams = new Set<string>()
  for (let index = 0; index <= units.length - size; index += 1) {
    grams.add(units.slice(index, index + size).join(''))
  }
  return grams
}

function diceCoefficient(left: Set<string>, right: Set<string>) {
  if (left.size === 0 || right.size === 0) {
    return 0
  }

  let overlap = 0
  for (const gram of left) {
    if (right.has(gram)) {
      overlap += 1
    }
  }

  return (2 * overlap) / (left.size + right.size)
}

function average(values: number[]) {
  if (values.length === 0) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function standardDeviation(values: number[]) {
  if (values.length <= 1) return 0
  const mean = average(values)
  const variance = average(values.map((value) => (value - mean) ** 2))
  return Math.sqrt(variance)
}

function buildBucketCandidates(areaInsight: AreaInsightInput) {
  const representativeRows = areaInsight.representativeSamples || []
  const rowsByCategory = new Map<string, Record<string, unknown>[]>()

  for (const row of representativeRows) {
    const categoryLabel = readSampleCategoryLabel(row)
    if (!categoryLabel) continue
    const key = normalizeKey(categoryLabel)
    const nextRows = rowsByCategory.get(key) || []
    nextRows.push(row)
    rowsByCategory.set(key, nextRows)
  }

  const histogramRows = areaInsight.categoryHistogram || []
  if (histogramRows.length > 0) {
    return histogramRows
      .map((row) => {
        const label = readBucketLabel(row)
        const count = readCount(row)
        if (!label || count <= 0) {
          return null
        }

        const sampleRows = rowsByCategory.get(normalizeKey(label)) || []
        const subCategoryHints = Array.from(new Set(
          sampleRows
            .map((item) => readSampleSubCategoryLabel(item))
            .filter(Boolean),
        )).slice(0, 2)
        const descriptor = [label, ...subCategoryHints].join(' ')

        return {
          label,
          count,
          sampleCount: sampleRows.length,
          descriptor: descriptor || label,
          sourceRow: row,
        } satisfies BucketCandidate
      })
      .filter((candidate): candidate is BucketCandidate => Boolean(candidate))
  }

  return Array.from(rowsByCategory.values())
    .map((rows) => {
      const first = rows[0]
      const label = readSampleCategoryLabel(first)
      const descriptor = [
        label,
        ...Array.from(new Set(rows.map((row) => readSampleSubCategoryLabel(row)).filter(Boolean))).slice(0, 2),
      ].join(' ')
      return {
        label,
        count: rows.length,
        sampleCount: rows.length,
        descriptor: descriptor || label,
        sourceRow: {
          category_main: label,
          poi_count: rows.length,
        },
      } satisfies BucketCandidate
    })
    .filter((candidate) => Boolean(candidate.label))
}

function buildSampleCandidates(rows: Record<string, unknown>[]) {
  return rows
    .map((row) => {
      const name = readSampleName(row)
      const categoryLabel = readSampleCategoryLabel(row)
      if (!name || !categoryLabel) {
        return null
      }

      return {
        name,
        categoryLabel,
        descriptor: [name, categoryLabel, readSampleSubCategoryLabel(row)].filter(Boolean).join(' '),
        sourceRow: row,
      } satisfies SampleCandidate
    })
    .filter((candidate): candidate is SampleCandidate => Boolean(candidate))
}

async function encodeTextMap(bridge: PythonBridge, texts: string[]) {
  const encoded = await Promise.all(
    texts.map(async (text) => {
      const normalized = trimText(text)
      const result = await bridge.encodeText(normalized)
      return [normalized, {
        text: normalized,
        vector: result.vector,
      } satisfies EncodedText] as const
    }),
  )

  return new Map<string, EncodedText>(encoded)
}

function resolveSemanticWeight(status?: SemanticEvidenceStatus) {
  if (!status) return 0.55
  if (status.level === 'available') return 0.8
  if (status.level === 'degraded') return 0.55
  return 0.35
}

function scoreCandidateText<T>(input: {
  query: string
  queryEncoded: EncodedText
  candidate: T
  candidateText: string
  encodedMap: Map<string, EncodedText>
  support?: number
  semanticWeight: number
}): ScoredCandidate<T> {
  const encodedCandidate = input.encodedMap.get(trimText(input.candidateText))
  const semanticScore = encodedCandidate
    ? cosineSimilarity(input.queryEncoded.vector, encodedCandidate.vector)
    : 0
  const lexicalScore = diceCoefficient(
    buildCharacterNgrams(input.query),
    buildCharacterNgrams(input.candidateText),
  )
  const supportBoost = 0.9 + Math.min(Math.max(input.support || 0, 0), 1) * 0.1
  let fusedScore = (
    semanticScore * input.semanticWeight
    + lexicalScore * (1 - input.semanticWeight)
  ) * supportBoost
  if (lexicalScore === 0 && semanticScore < 0.98) {
    fusedScore *= 0.82
  }

  return {
    candidate: input.candidate,
    score: Number(fusedScore.toFixed(4)),
  }
}

function resolveKeepThreshold(scores: number[]) {
  if (scores.length === 0) return null
  if (scores.length === 1) return scores[0]

  const sorted = [...scores].sort((left, right) => right - left)
  const best = sorted[0]
  const second = sorted[1] ?? 0
  const mean = average(sorted)
  const deviation = standardDeviation(sorted)
  const focused = best >= 0.45 && (best - second) >= 0.18

  if (focused) {
    return Number(Math.max(mean + deviation * 0.2, best * 0.78).toFixed(4))
  }

  return Number(Math.max(mean + deviation * 0.08, best * 0.58).toFixed(4))
}

function resolveMinimumKeep(scores: number[]) {
  if (scores.length <= 1) return scores.length

  const sorted = [...scores].sort((left, right) => right - left)
  const best = sorted[0]
  const second = sorted[1] ?? 0
  const focused = best >= 0.45 && (best - second) >= 0.18
  return focused ? 1 : Math.min(2, scores.length)
}

function pickRetainedCandidates<T>(input: {
  scored: Array<ScoredCandidate<T>>
  threshold: number | null
  minKeep: number
  maxKeep?: number
}) {
  const ranked = [...input.scored].sort((left, right) => right.score - left.score)
  if (ranked.length <= input.minKeep) {
    return ranked
  }

  const retained = ranked.filter((item, index) => (
    index < input.minKeep
      || input.threshold == null
      || item.score >= input.threshold
  ))

  if (input.maxKeep && retained.length > input.maxKeep) {
    return retained.slice(0, input.maxKeep)
  }

  return retained
}

function filterCompetitionDensityRows(
  rows: Record<string, unknown>[] = [],
  keptCategoryKeys: Set<string>,
) {
  if (keptCategoryKeys.size === 0) {
    return rows
  }

  return rows.filter((row) => keptCategoryKeys.has(normalizeKey(readBucketLabel(row))))
}

export class IntentAwareAreaSemanticDenoiser implements AreaSemanticDenoiser {
  private readonly primaryBridge: PythonBridge

  private readonly fallbackBridge: PythonBridge

  constructor(options: {
    bridge?: PythonBridge
    fallbackBridge?: PythonBridge
  } = {}) {
    this.fallbackBridge = options.fallbackBridge || new LocalPythonBridge()
    this.primaryBridge = options.bridge || new RemoteFirstPythonBridge({
      timeoutMs: 1500,
      fallback: this.fallbackBridge,
    })
  }

  private async resolveBridge() {
    const status = toSemanticEvidenceStatus(await this.primaryBridge.getStatus())
    const bridge = status.mode === 'remote' || status.mode === 'local'
      ? this.primaryBridge
      : this.fallbackBridge

    return {
      bridge,
      semanticEvidence: status,
    }
  }

  async denoise(input: {
    rawQuery: string
    anchorName?: string | null
    areaInsight: AreaInsightInput
    fallbackRows?: Record<string, unknown>[]
  }): Promise<AreaSemanticDenoiseResult> {
    const focusQuery = normalizeFocusText(input.rawQuery, input.anchorName) || trimText(input.rawQuery)
    const representativeRows = input.areaInsight.representativeSamples?.length
      ? input.areaInsight.representativeSamples
      : (input.fallbackRows || [])
    const bucketCandidates = buildBucketCandidates({
      ...input.areaInsight,
      representativeSamples: representativeRows,
    })
    const sampleCandidates = buildSampleCandidates(representativeRows)

    if (!focusQuery || (bucketCandidates.length === 0 && sampleCandidates.length === 0)) {
      return {
        rows: representativeRows,
        areaInsight: input.areaInsight,
        diagnostics: {
          applied: false,
          keptCategories: [],
          droppedCategories: [],
          keptSamples: representativeRows.map((row) => readSampleName(row)).filter(Boolean),
          droppedSamples: [],
          threshold: null,
        },
      }
    }

    const { bridge, semanticEvidence } = await this.resolveBridge()
    const encodedMap = await encodeTextMap(bridge, [
      focusQuery,
      ...bucketCandidates.map((candidate) => normalizeFocusText(candidate.descriptor, input.anchorName) || candidate.label),
      ...sampleCandidates.map((candidate) => normalizeFocusText(candidate.descriptor, input.anchorName) || candidate.categoryLabel),
    ])
    const queryEncoded = encodedMap.get(trimText(focusQuery))
    if (!queryEncoded) {
      return {
        rows: representativeRows,
        areaInsight: input.areaInsight,
        semanticEvidence,
        diagnostics: {
          applied: false,
          keptCategories: [],
          droppedCategories: [],
          keptSamples: representativeRows.map((row) => readSampleName(row)).filter(Boolean),
          droppedSamples: [],
          threshold: null,
        },
      }
    }

    const semanticWeight = resolveSemanticWeight(semanticEvidence)
    const maxBucketCount = Math.max(...bucketCandidates.map((candidate) => candidate.count), 1)
    const maxBucketSampleCount = Math.max(...bucketCandidates.map((candidate) => candidate.sampleCount), 1)
    const scoredBuckets = bucketCandidates.map((candidate) => scoreCandidateText({
      query: focusQuery,
      queryEncoded,
      candidate,
      candidateText: normalizeFocusText(candidate.descriptor, input.anchorName) || candidate.label,
      encodedMap,
      support: (() => {
        const countSupport = Math.sqrt(candidate.count / maxBucketCount)
        const sampleSupport = candidate.sampleCount > 0
          ? Math.sqrt(candidate.sampleCount / maxBucketSampleCount)
          : 0
        const fusedSupport = countSupport * 0.2 + sampleSupport * 0.8
        return candidate.sampleCount > 0 ? fusedSupport : fusedSupport * 0.45
      })(),
      semanticWeight,
    }))
    const bucketThreshold = resolveKeepThreshold(scoredBuckets.map((candidate) => candidate.score))
    const retainedBuckets = pickRetainedCandidates({
      scored: scoredBuckets,
      threshold: bucketThreshold,
      minKeep: resolveMinimumKeep(scoredBuckets.map((candidate) => candidate.score)),
      maxKeep: 6,
    })
    const keptCategoryKeys = new Set(retainedBuckets.map((item) => normalizeKey(item.candidate.label)))
    const retainedCategoryRows = (input.areaInsight.categoryHistogram || []).length > 0
      ? (input.areaInsight.categoryHistogram || []).filter((row) => keptCategoryKeys.has(normalizeKey(readBucketLabel(row))))
      : retainedBuckets.map((item) => item.candidate.sourceRow)

    const scoredSamples = sampleCandidates.map((candidate) => {
      const categoryBoost = keptCategoryKeys.has(normalizeKey(candidate.categoryLabel)) ? 1 : 0.7
      return scoreCandidateText({
        query: focusQuery,
        queryEncoded,
        candidate,
        candidateText: normalizeFocusText(candidate.descriptor, input.anchorName) || candidate.categoryLabel,
        encodedMap,
        support: categoryBoost,
        semanticWeight,
      })
    })
    const sampleThreshold = resolveKeepThreshold(scoredSamples.map((candidate) => candidate.score))
    const retainedSamples = pickRetainedCandidates({
      scored: scoredSamples.filter((candidate) => keptCategoryKeys.size === 0 || keptCategoryKeys.has(normalizeKey(candidate.candidate.categoryLabel))),
      threshold: sampleThreshold,
      minKeep: resolveMinimumKeep(scoredSamples.map((candidate) => candidate.score)),
      maxKeep: 8,
    })
    const keptSampleRows = new Set(retainedSamples.map((item) => item.candidate.sourceRow))
    const filteredRepresentativeRows = representativeRows.filter((row) => keptSampleRows.has(row))

    const nextAreaInsight: AreaInsightInput = {
      ...input.areaInsight,
      categoryHistogram: retainedCategoryRows.length > 0
        ? retainedCategoryRows
        : input.areaInsight.categoryHistogram,
      representativeSamples: filteredRepresentativeRows.length > 0
        ? filteredRepresentativeRows
        : (keptCategoryKeys.size === 0 ? input.areaInsight.representativeSamples : []),
      competitionDensity: filterCompetitionDensityRows(input.areaInsight.competitionDensity, keptCategoryKeys),
    }
    const retainedRowPool = filteredRepresentativeRows.length > 0
      ? filteredRepresentativeRows
      : (keptCategoryKeys.size === 0 ? representativeRows : [])
    const retainedSampleNames = new Set(retainedRowPool.map((row) => readSampleName(row)))

    return {
      rows: retainedRowPool,
      areaInsight: nextAreaInsight,
      semanticEvidence: mergeSemanticEvidenceStatuses([semanticEvidence]),
      diagnostics: {
        applied: true,
        keptCategories: retainedBuckets.map((item) => item.candidate.label),
        droppedCategories: bucketCandidates
          .map((item) => item.label)
          .filter((label) => !keptCategoryKeys.has(normalizeKey(label))),
        keptSamples: retainedRowPool
          .map((row) => readSampleName(row))
          .filter(Boolean),
        droppedSamples: representativeRows
          .map((row) => readSampleName(row))
          .filter((name) => !retainedSampleNames.has(name)),
        threshold: bucketThreshold,
        focusQuery,
      },
    }
  }
}
